import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActionReservationConflictError,
  createActionRepository,
  NativeIdentityBindingError,
  NativeAuthRequestConflictError,
  RateLimitExceededError,
  type ActionOwner,
  type ReserveActionInput,
} from "./index";

const requestId = "0d9204a8-0c7f-4e67-ae31-b9bb5fef1cdf";
const deviceUuid = "b21c1f57-52f1-4e3f-89ee-1c93584a2166";
const challenge = "a".repeat(43);
const stateHash = "1".repeat(64);
const codeHash = "2".repeat(64);
const evidenceDigest = "4".repeat(64);

const owner: ActionOwner = {
  issuer: "https://identity.example.test",
  subject: "user-123",
  relutionUsername: "alex.morgan",
};

const nativeUser = {
  id: "portal-user-123",
  ...owner,
  displayName: "Alex Morgan",
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeRepository(now = 1_767_268_800_000) {
  const directory = mkdtempSync(join(tmpdir(), "windows-store-persistence-"));
  temporaryDirectories.push(directory);
  let clock = now;
  const repository = createActionRepository(join(directory, "private", "actions.db"), () => clock);
  return {
    repository,
    databasePath: join(directory, "private", "actions.db"),
    setNow: (value: number) => {
      clock = value;
    },
  };
}

function makeLegacyVersionOneDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "windows-store-legacy-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "actions.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE actions (
      id TEXT PRIMARY KEY,
      owner_issuer TEXT NOT NULL,
      owner_subject TEXT NOT NULL,
      relution_username TEXT NOT NULL,
      device_uuid TEXT NOT NULL,
      app_uuid TEXT NOT NULL,
      target_version_uuid TEXT NOT NULL,
      installed_version_uuid TEXT,
      package_identifier TEXT,
      intent TEXT NOT NULL CHECK (intent IN ('install', 'update')),
      idempotency_hash TEXT NOT NULL CHECK (length(idempotency_hash) = 64),
      state TEXT NOT NULL CHECK (state IN (
        'reserved', 'queued', 'sent', 'deferred', 'verifying',
        'succeeded', 'failed', 'cancelled', 'unknown'
      )),
      relution_state TEXT,
      relution_action_uuid TEXT,
      correlation_started_at INTEGER,
      verification_deadline_at INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      submitted_at INTEGER,
      updated_at INTEGER NOT NULL,
      terminal_at INTEGER,
      UNIQUE (
        owner_issuer, owner_subject, device_uuid, app_uuid, idempotency_hash
      )
    );
    CREATE UNIQUE INDEX actions_active_reservation
      ON actions(device_uuid, app_uuid, target_version_uuid)
      WHERE state IN (
        'reserved', 'queued', 'sent', 'deferred', 'verifying', 'unknown'
      );
    CREATE INDEX actions_owner_created
      ON actions(owner_issuer, owner_subject, created_at DESC);
    CREATE INDEX actions_terminal
      ON actions(terminal_at) WHERE terminal_at IS NOT NULL;
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
      owner_issuer TEXT NOT NULL,
      owner_subject TEXT NOT NULL,
      relution_username TEXT NOT NULL,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX audit_events_action ON audit_events(action_id, id);
    PRAGMA user_version = 1;
  `);
  return { database, databasePath };
}

function makeVersionTwoDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "windows-store-v2-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "actions.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE actions (id TEXT PRIMARY KEY);
    CREATE TABLE audit_events (id INTEGER PRIMARY KEY, action_id TEXT);
    PRAGMA user_version = 2;
  `);
  database.close();
  return databasePath;
}

function insertLegacyAction(
  database: DatabaseSync,
  values: {
    id: string;
    deviceId: string;
    appId: string;
    targetVersionId: string;
    idempotencyHash: string;
    state?: "reserved" | "failed";
  },
) {
  database
    .prepare(
      `INSERT INTO actions (
        id, owner_issuer, owner_subject, relution_username, device_uuid,
        app_uuid, target_version_uuid, package_identifier, intent,
        idempotency_hash, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'update', ?, ?, 1, 1)`,
    )
    .run(
      values.id,
      owner.issuer,
      owner.subject,
      owner.relutionUsername,
      values.deviceId,
      values.appId,
      values.targetVersionId,
      "Mozilla.Firefox",
      values.idempotencyHash,
      values.state ?? "reserved",
    );
}

function reservation(overrides: Partial<ReserveActionInput> = {}): ReserveActionInput {
  return {
    owner,
    deviceId: "device-1",
    appId: "firefox",
    packageIdentifier: "Mozilla.Firefox",
    installedVersionId: "firefox-128.0.3",
    targetVersionId: "firefox-128.0.4",
    intent: "update",
    idempotencyKey: "client-request-1",
    ...overrides,
  };
}

describe("SqliteActionRepository", () => {
  it("requires an absolute database path", () => {
    expect(() => createActionRepository("actions.db")).toThrow(
      "Database path must be an absolute path.",
    );
  });

  it("creates a private parent directory and database, then applies migrations", () => {
    const { repository, databasePath } = makeRepository();
    try {
      expect(() => repository.check()).not.toThrow();
      expect(statSync(dirname(databasePath)).mode & 0o777).toBe(0o700);
      expect(statSync(databasePath).mode & 0o777).toBe(0o600);
      expect(repository.getRateLimit(owner)).toMatchObject({
        allowed: true,
        remaining: 8,
        resetAt: null,
      });
    } finally {
      repository.close();
    }
  });

  it("durably deduplicates a request and reserves one active action per device and app", () => {
    const { repository, databasePath } = makeRepository();
    try {
      const first = repository.reserveAction(reservation());
      const duplicate = repository.reserveAction(reservation());
      const active = repository.reserveAction(
        reservation({ idempotencyKey: "a-different-client-request" }),
      );
      expect(first).toMatchObject({ created: true, reason: "created" });
      expect(duplicate).toMatchObject({ created: false, reason: "idempotent" });
      expect(active).toMatchObject({ created: false, reason: "active" });
      expect(duplicate.action.id).toBe(first.action.id);
      expect(active.action.id).toBe(first.action.id);
      expect(() =>
        repository.reserveAction(
          reservation({
            owner: {
              ...owner,
              subject: "another-user",
              relutionUsername: "other.user",
            },
            idempotencyKey: "another-owner-request",
          }),
        ),
      ).toThrow(ActionReservationConflictError);
      expect(repository.listAuditEvents(owner, first.action.id)).toMatchObject([
        { event: "reserved", outcome: "reserved" },
      ]);
    } finally {
      repository.close();
    }

    const reopened = createActionRepository(databasePath);
    try {
      const duplicateAfterRestart = reopened.reserveAction(reservation());
      expect(duplicateAfterRestart).toMatchObject({
        created: false,
        reason: "idempotent",
      });
    } finally {
      reopened.close();
    }
  });

  it("rejects idempotency-key reuse and locks an app across release changes", () => {
    const { repository } = makeRepository();
    try {
      repository.reserveAction(reservation());

      expect(() =>
        repository.reserveAction(
          reservation({
            deviceId: "another-device",
            appId: "another-app",
            targetVersionId: "another-version",
          }),
        ),
      ).toThrowError(
        expect.objectContaining({ reason: "idempotency_key_reused" }),
      );

      expect(() =>
        repository.reserveAction(
          reservation({
            targetVersionId: "firefox-129.0.0",
            idempotencyKey: "new-release-request",
          }),
        ),
      ).toThrowError(
        expect.objectContaining({ reason: "action_already_active" }),
      );
    } finally {
      repository.close();
    }
  });

  it("migrates version-one active reservations to device-and-app locking", () => {
    const { database, databasePath } = makeLegacyVersionOneDatabase();
    database.close();

    const migrated = createActionRepository(databasePath);
    try {
      migrated.reserveAction(reservation());
      expect(() =>
        migrated.reserveAction(
          reservation({
            targetVersionId: "firefox-129.0.0",
            idempotencyKey: "new-release-request",
          }),
        ),
      ).toThrowError(
        expect.objectContaining({ reason: "action_already_active" }),
      );
    } finally {
      migrated.close();
    }
  });

  it("migrates a version-two database through security schema version five", () => {
    const databasePath = makeVersionTwoDatabase();
    const repository = createActionRepository(databasePath);
    try {
      const database = new DatabaseSync(databasePath);
      expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 });
      database.close();
      expect(
        repository.createNativeAuthRequest({
          requestId,
          challenge,
          stateHash,
          loopbackPort: 49152,
        }),
      ).toMatchObject({ status: "pending", loopbackPort: 49152 });
    } finally {
      repository.close();
    }
  });

  it("revokes pre-binding native sessions during the version-three migration", () => {
    const { repository, databasePath } = makeRepository();
    const tokenHash = "9".repeat(64);
    repository.createNativeSession({
      owner: nativeUser,
      tokenHash,
      deviceUuid,
      evidenceDigest,
      clientVersion: "0.1.0",
    });
    repository.close();

    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      DROP TABLE security_events;
      DROP TABLE native_identity_bindings;
      PRAGMA user_version = 3;
    `);
    legacy.close();

    const migrated = createActionRepository(databasePath, () => 1_767_268_801_000);
    try {
      expect(migrated.authenticateNativeSession(tokenHash)).toBeNull();
      const database = new DatabaseSync(databasePath);
      expect(
        database
          .prepare("SELECT revoked_at FROM native_sessions WHERE token_hash = ?")
          .get(tokenHash),
      ).toEqual({ revoked_at: 1_767_268_801_000 });
      database.close();
    } finally {
      migrated.close();
    }
  });

  it("diagnoses legacy active-action conflicts before migration", () => {
    const { database, databasePath } = makeLegacyVersionOneDatabase();
    insertLegacyAction(database, {
      id: "legacy-active-1",
      deviceId: "device-1",
      appId: "firefox",
      targetVersionId: "firefox-128",
      idempotencyHash: "1".repeat(64),
    });
    insertLegacyAction(database, {
      id: "legacy-active-2",
      deviceId: "device-1",
      appId: "firefox",
      targetVersionId: "firefox-129",
      idempotencyHash: "2".repeat(64),
    });
    database.close();

    expect(() => createActionRepository(databasePath)).toThrow(
      "multiple active actions exist for one device and app",
    );
  });

  it("diagnoses legacy idempotency reuse before migration", () => {
    const { database, databasePath } = makeLegacyVersionOneDatabase();
    const reusedHash = "3".repeat(64);
    insertLegacyAction(database, {
      id: "legacy-request-1",
      deviceId: "device-1",
      appId: "firefox",
      targetVersionId: "firefox-128",
      idempotencyHash: reusedHash,
      state: "failed",
    });
    insertLegacyAction(database, {
      id: "legacy-request-2",
      deviceId: "device-2",
      appId: "vlc",
      targetVersionId: "vlc-4",
      idempotencyHash: reusedHash,
      state: "failed",
    });
    database.close();

    expect(() => createActionRepository(databasePath)).toThrow(
      "an owner reused an idempotency key for different requests",
    );
  });

  it("updates state and errors with an immutable audit trail and owner isolation", () => {
    const { repository } = makeRepository();
    try {
      const { action } = repository.reserveAction(reservation());
      const updated = repository.updateAction({
        owner,
        id: action.id,
        state: "failed",
        relutionState: "command_failed",
        relutionActionUuid: "3b81113d-a95f-4c48-bc6d-1b60c3db536d",
        errorCode: "INSTALLER_EXIT_CODE",
        errorMessage: "The installer failed.",
        event: "relution_completion",
      });

      expect(updated).toMatchObject({
        state: "failed",
        relutionState: "command_failed",
        errorCode: "INSTALLER_EXIT_CODE",
      });
      expect(repository.listAuditEvents(owner, action.id).map((event) => event.event)).toEqual([
        "reserved",
        "relution_completion",
      ]);
      expect(
        repository.getAction(
          { issuer: owner.issuer, subject: "different-user" },
          action.id,
        ),
      ).toBeNull();
    } finally {
      repository.close();
    }
  });

  it("enforces eight new reservations in a rolling minute without charging duplicates", () => {
    const { repository, setNow } = makeRepository();
    try {
      for (let index = 0; index < 8; index += 1) {
        repository.reserveAction(
          reservation({
            deviceId: `device-${index}`,
            appId: `app-${index}`,
            idempotencyKey: `request-${index}`,
          }),
        );
      }
      expect(repository.getRateLimit(owner)).toMatchObject({
        allowed: false,
        remaining: 0,
      });
      expect(() =>
        repository.reserveAction(
          reservation({
            deviceId: "device-9",
            appId: "app-9",
            idempotencyKey: "request-9",
          }),
        ),
      ).toThrow(RateLimitExceededError);

      const duplicate = repository.reserveAction(
        reservation({
          deviceId: "device-0",
          appId: "app-0",
          idempotencyKey: "request-0",
        }),
      );
      expect(duplicate).toMatchObject({ created: false, reason: "idempotent" });

      setNow(1_767_268_860_001);
      expect(repository.getRateLimit(owner).allowed).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("purges only terminal actions and retains reserved and unknown actions", () => {
    const { repository, setNow } = makeRepository();
    try {
      const resolved = repository.reserveAction(reservation({ appId: "resolved" })).action;
      const unresolved = repository.reserveAction(
        reservation({ appId: "unresolved", deviceId: "device-unresolved", idempotencyKey: "unresolved" }),
      ).action;
      const unknown = repository.reserveAction(
        reservation({
          appId: "unknown",
          deviceId: "device-unknown",
          idempotencyKey: "unknown",
        }),
      ).action;
      repository.updateAction({
        owner,
        id: resolved.id,
        state: "succeeded",
      });
      repository.updateAction({
        owner,
        id: unknown.id,
        state: "unknown",
      });
      setNow(1_767_268_800_000 + 91 * 24 * 60 * 60 * 1_000);

      expect(repository.cleanup()).toBe(1);
      expect(repository.getAction(owner, resolved.id)).toBeNull();
      expect(repository.getAction(owner, unresolved.id)).not.toBeNull();
      expect(repository.getAction(owner, unknown.id)).toMatchObject({
        state: "unknown",
      });
      expect(repository.listAuditEvents(owner, resolved.id)).toEqual([]);
    } finally {
      repository.close();
    }
  });

  it("replays only an identical pending native request and atomically consumes its one-time code", () => {
    const { repository } = makeRepository();
    try {
      const created = repository.createNativeAuthRequest({
        requestId,
        challenge,
        stateHash,
        loopbackPort: 49152,
      });
      expect(
        repository.createNativeAuthRequest({
          requestId,
          challenge,
          stateHash,
          loopbackPort: 49152,
        }),
      ).toMatchObject({ requestId: created.requestId, status: "pending" });
      expect(() =>
        repository.createNativeAuthRequest({
          requestId,
          challenge: "b".repeat(43),
          stateHash,
          loopbackPort: 49152,
        }),
      ).toThrow(NativeAuthRequestConflictError);

      expect(repository.authorizeNativeAuthRequest(requestId, nativeUser, codeHash)).toMatchObject({
        status: "authorized",
        owner: { subject: owner.subject },
      });
      expect(repository.consumeNativeAuthRequest(requestId, codeHash, challenge)).toMatchObject({
        requestId,
        owner: { issuer: owner.issuer, subject: owner.subject },
      });
      expect(repository.consumeNativeAuthRequest(requestId, codeHash, challenge)).toBeNull();
    } finally {
      repository.close();
    }
  });

  it("rejects expired native auth codes and requests", () => {
    const { repository, setNow } = makeRepository();
    try {
      repository.createNativeAuthRequest({ requestId, challenge, stateHash, loopbackPort: 49152 });
      expect(repository.authorizeNativeAuthRequest(requestId, nativeUser, codeHash)).not.toBeNull();
      setNow(1_767_268_800_000 + 120_001);
      expect(repository.consumeNativeAuthRequest(requestId, codeHash, challenge)).toBeNull();

      const secondRequest = "31f1d0a8-0c7f-4e67-ae31-b9bb5fef1cdf";
      setNow(1_767_268_800_000);
      repository.createNativeAuthRequest({
        requestId: secondRequest,
        challenge,
        stateHash,
        loopbackPort: 49153,
      });
      setNow(1_767_268_800_000 + 300_001);
      expect(repository.authorizeNativeAuthRequest(secondRequest, nativeUser, codeHash)).toBeNull();
    } finally {
      repository.close();
    }
  });

  it("keeps at most three active native sessions per owner and device, touches tokens, and cleans expired data", () => {
    const { repository, setNow } = makeRepository();
    try {
      const hashes = ["3", "5", "6", "7"].map((character) => character.repeat(64));
      for (const hash of hashes) {
        repository.createNativeSession({
          owner: nativeUser,
          tokenHash: hash,
          deviceUuid,
          evidenceDigest,
          clientVersion: "1.2.3",
        });
        setNow(1_767_268_800_000 + (hashes.indexOf(hash) + 1) * 1_000);
      }
      expect(repository.authenticateNativeSession(hashes[0])).toBeNull();
      const active = repository.authenticateNativeSession(hashes[3]);
      expect(active).toMatchObject({ deviceUuid, revokedAt: null });
      expect(repository.revokeNativeSession(hashes[3])).toBe(true);
      expect(repository.revokeNativeSession(hashes[3])).toBe(false);

      repository.createNativeAuthRequest({ requestId, challenge, stateHash, loopbackPort: 49152 });
      setNow(1_767_268_800_000 + 8 * 24 * 60 * 60 * 1_000);
      expect(repository.cleanupNativeAuth()).toMatchObject({ requests: 1, sessions: 4 });
    } finally {
      repository.close();
    }
  });

  it("pins an OIDC identity to one Relution UUID while allowing username continuity", () => {
    const { repository } = makeRepository();
    try {
      repository.assertNativeIdentityBinding(nativeUser, "relution-user-1");
      expect(() =>
        repository.assertNativeIdentityBinding(
          { ...nativeUser, relutionUsername: "alex.renamed" },
          "relution-user-1",
        ),
      ).not.toThrow();
      expect(() =>
        repository.assertNativeIdentityBinding(nativeUser, "relution-user-2"),
      ).toThrow(NativeIdentityBindingError);
      expect(() =>
        repository.assertNativeIdentityBinding(
          { ...nativeUser, id: "other", subject: "other" },
          "relution-user-1",
        ),
      ).toThrow(NativeIdentityBindingError);
    } finally {
      repository.close();
    }
  });

  it("expires sessions after eight hours and supports emergency scoped revocation", () => {
    const { repository, setNow } = makeRepository();
    const firstHash = "8".repeat(64);
    const secondHash = "9".repeat(64);
    try {
      repository.createNativeSession({
        owner: nativeUser,
        tokenHash: firstHash,
        deviceUuid,
        evidenceDigest,
        clientVersion: "0.1.0-alpha.1",
      });
      repository.createNativeSession({
        owner: { ...nativeUser, id: "other", subject: "other" },
        tokenHash: secondHash,
        deviceUuid: "other-device",
        evidenceDigest,
        clientVersion: "0.1.0-alpha.1",
      });
      expect(
        repository.revokeNativeSessions({
          kind: "user",
          issuer: nativeUser.issuer,
          subject: nativeUser.subject,
        }),
      ).toBe(1);
      expect(repository.authenticateNativeSession(firstHash)).toBeNull();
      expect(repository.authenticateNativeSession(secondHash)).not.toBeNull();

      setNow(1_767_268_800_000 + 8 * 60 * 60 * 1_000 + 1);
      expect(repository.authenticateNativeSession(secondHash)).toBeNull();
    } finally {
      repository.close();
    }
  });

  it("stores only hashed security-event identifiers", () => {
    const { repository, databasePath } = makeRepository();
    repository.recordSecurityEvent({
      event: "native_session_created",
      outcome: "success",
      owner: nativeUser,
      deviceUuid,
      requestId,
    });
    repository.close();

    const database = new DatabaseSync(databasePath);
    try {
      const row = database
        .prepare(
          `SELECT owner_hash, device_hash, request_id
           FROM security_events`,
        )
        .get() as {
        owner_hash: string;
        device_hash: string;
        request_id: string;
      };
      expect(row.owner_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.device_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.request_id).toBe(requestId);
      expect(JSON.stringify(row)).not.toContain(nativeUser.relutionUsername);
      expect(JSON.stringify(row)).not.toContain(deviceUuid);
    } finally {
      database.close();
    }
  });
});
