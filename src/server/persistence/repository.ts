import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActionIntent, ActionState, PortalUser } from "@/domain/models";

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const NATIVE_AUTH_REQUEST_TTL_MS = 5 * 60 * 1_000;
const NATIVE_AUTH_CODE_TTL_MS = 2 * 60 * 1_000;
const NATIVE_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const NATIVE_SESSION_LIMIT = 3;
const NATIVE_PENDING_REQUEST_LIMIT = 1_000;
export type StoredActionState = "reserved" | ActionState;

const ACTIVE_STATES = new Set<StoredActionState>([
  "reserved",
  "queued",
  "sent",
  "deferred",
  "verifying",
  "unknown",
]);
const TERMINAL_STATES = new Set<StoredActionState>([
  "succeeded",
  "failed",
  "cancelled",
]);

export interface ActionOwner {
  issuer: string;
  subject: string;
  relutionUsername: string;
}

export interface PersistedAction {
  id: string;
  owner: ActionOwner;
  deviceId: string;
  appId: string;
  targetVersionId: string;
  installedVersionId: string | null;
  packageIdentifier: string | null;
  intent: ActionIntent;
  state: StoredActionState;
  relutionState: string | null;
  relutionActionUuid: string | null;
  correlationStartedAt: string | null;
  verificationDeadlineAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string;
  terminalAt: string | null;
}

export interface ReserveActionInput {
  owner: ActionOwner;
  deviceId: string;
  appId: string;
  targetVersionId: string;
  installedVersionId: string | null;
  packageIdentifier: string | null;
  intent: ActionIntent;
  idempotencyKey: string;
}

export interface ReservationResult {
  action: PersistedAction;
  created: boolean;
  reason: "created" | "idempotent" | "active";
}

export interface UpdateActionInput {
  owner: Pick<ActionOwner, "issuer" | "subject">;
  id: string;
  state?: StoredActionState;
  relutionState?: string | null;
  relutionActionUuid?: string | null;
  correlationStartedAt?: string | null;
  verificationDeadlineAt?: string | null;
  submittedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  event?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface AuditEvent {
  id: number;
  actionId: string;
  event: string;
  outcome: StoredActionState;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetAt: string | null;
}

export interface CreateNativeAuthRequestInput {
  requestId: string;
  challenge: string;
  stateHash: string;
  loopbackPort: number;
}

export interface NativeAuthRequest {
  requestId: string;
  challenge: string;
  stateHash: string;
  loopbackPort: number;
  status: "pending" | "authorized" | "consumed";
  owner: ActionOwner | null;
  expiresAt: string;
  codeExpiresAt: string | null;
  createdAt: string;
  authorizedAt: string | null;
  consumedAt: string | null;
}

export interface NativeAuthGrant {
  owner: PortalUser;
  requestId: string;
  loopbackPort: number;
}

export interface CreateNativeSessionInput {
  owner: PortalUser;
  tokenHash: string;
  deviceUuid: string;
  evidenceDigest: string;
  clientVersion: string;
}

export interface NativeSession {
  id: string;
  owner: PortalUser;
  deviceUuid: string;
  evidenceDigest: string;
  clientVersion: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface NativeAuthCleanupResult {
  requests: number;
  sessions: number;
}

export interface SecurityEventInput {
  event: string;
  outcome: "success" | "denied" | "failure";
  owner?: Pick<PortalUser, "issuer" | "subject">;
  deviceUuid?: string;
  requestId?: string;
}

interface ActionRow {
  id: string;
  owner_issuer: string;
  owner_subject: string;
  relution_username: string;
  device_uuid: string;
  app_uuid: string;
  target_version_uuid: string;
  installed_version_uuid: string | null;
  package_identifier: string | null;
  intent: ActionIntent;
  state: StoredActionState;
  relution_state: string | null;
  relution_action_uuid: string | null;
  correlation_started_at: number | null;
  verification_deadline_at: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  submitted_at: number | null;
  updated_at: number;
  terminal_at: number | null;
}

interface AuditRow {
  id: number;
  action_id: string;
  event_type: string;
  outcome: StoredActionState;
  details_json: string;
  created_at: number;
}

interface NativeAuthRequestRow {
  request_id: string;
  verifier_challenge: string;
  state_hash: string;
  loopback_port: number;
  status: "pending" | "authorized" | "consumed";
  owner_issuer: string | null;
  owner_subject: string | null;
  relution_username: string | null;
  display_name: string | null;
  code_hash: string | null;
  expires_at: number;
  code_expires_at: number | null;
  created_at: number;
  authorized_at: number | null;
  consumed_at: number | null;
}

interface NativeSessionRow {
  id: string;
  token_hash: string;
  owner_issuer: string;
  owner_subject: string;
  relution_username: string;
  display_name: string;
  device_uuid: string;
  evidence_digest: string;
  client_version: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMITED";

  constructor() {
    super("Too many application requests. Try again shortly.");
    this.name = "RateLimitExceededError";
  }
}

export class ActionReservationConflictError extends Error {
  readonly code = "ACTION_CONFLICT";

  constructor(
    public readonly reason: "idempotency_key_reused" | "action_already_active",
  ) {
    super(
      reason === "idempotency_key_reused"
        ? "The idempotency key was already used for a different request."
        : "Another application action is already active for this device.",
    );
    this.name = "ActionReservationConflictError";
  }
}

export class NativeAuthRequestConflictError extends Error {
  readonly code = "NATIVE_AUTH_REQUEST_CONFLICT";

  constructor() {
    super("The native authorization request ID is already in use for a different or completed request.");
    this.name = "NativeAuthRequestConflictError";
  }
}

export class NativeAuthCapacityError extends Error {
  readonly code = "NATIVE_AUTH_CAPACITY";

  constructor() {
    super("Too many native authorization requests are pending.");
    this.name = "NativeAuthCapacityError";
  }
}

export class NativeIdentityBindingError extends Error {
  readonly code = "NATIVE_IDENTITY_BINDING";

  constructor() {
    super("The OIDC identity no longer resolves to its original Relution user.");
    this.name = "NativeIdentityBindingError";
  }
}

/** Synchronous and server-only. Never wrap network I/O in repository calls. */
export class SqliteActionRepository {
  private readonly database: DatabaseSync;

  constructor(
    databasePath: string,
    private readonly now: () => number = Date.now,
  ) {
    assertAbsoluteDatabasePath(databasePath);
    ensureDatabaseDirectory(databasePath);
    this.database = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  close() {
    this.database.close();
  }

  check() {
    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.database.exec("UPDATE actions SET updated_at = updated_at WHERE 0");
      this.database.exec("ROLLBACK");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original readiness failure.
      }
      throw error;
    }
  }

  reserveAction(input: ReserveActionInput): ReservationResult {
    validateReserveInput(input);
    const hash = createHash("sha256")
      .update(input.idempotencyKey)
      .digest("hex");
    const now = this.now();
    return this.transaction(() => {
      const duplicate = this.findByIdempotency(input, hash);
      if (duplicate) {
        if (!sameRequest(duplicate, input)) {
          throw new ActionReservationConflictError("idempotency_key_reused");
        }
        return {
          action: toAction(duplicate),
          created: false,
          reason: "idempotent",
        };
      }
      const active = this.findActive(input);
      if (active) {
        if (
          active.owner_issuer !== input.owner.issuer ||
          active.owner_subject !== input.owner.subject ||
          !sameRequest(active, input)
        ) {
          throw new ActionReservationConflictError("action_already_active");
        }
        return { action: toAction(active), created: false, reason: "active" };
      }
      if (!this.getRateLimit(input.owner, now).allowed) {
        throw new RateLimitExceededError();
      }

      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO actions (
            id, owner_issuer, owner_subject, relution_username, device_uuid,
            app_uuid, target_version_uuid, installed_version_uuid,
            package_identifier, intent, idempotency_hash, state, created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
        )
        .run(
          id,
          input.owner.issuer,
          input.owner.subject,
          input.owner.relutionUsername,
          input.deviceId,
          input.appId,
          input.targetVersionId,
          input.installedVersionId,
          input.packageIdentifier,
          input.intent,
          hash,
          now,
          now,
        );
      const row = this.getOwnedRow(id, input.owner);
      if (!row) throw new Error("Reserved action could not be read back.");
      this.insertAuditEvent(row, "reserved", {}, now);
      return { action: toAction(row), created: true, reason: "created" };
    });
  }

  getAction(
    owner: Pick<ActionOwner, "issuer" | "subject">,
    id: string,
  ): PersistedAction | null {
    validateOwner(owner);
    const row = this.getOwnedRow(id, owner);
    return row ? toAction(row) : null;
  }

  updateAction(input: UpdateActionInput): PersistedAction | null {
    validateOwner(input.owner);
    if (!input.id) throw new Error("Action id is required.");
    if (input.state && !isStoredState(input.state)) {
      throw new Error("Unknown action state.");
    }

    return this.transaction(() => {
      const current = this.getOwnedRow(input.id, input.owner);
      if (!current) return null;
      const now = this.now();
      const state = input.state ?? current.state;
      const terminalAt = TERMINAL_STATES.has(state)
        ? current.terminal_at ?? now
        : null;
      this.database
        .prepare(
          `UPDATE actions SET
            state = ?, relution_state = ?, relution_action_uuid = ?,
            correlation_started_at = ?, verification_deadline_at = ?,
            submitted_at = ?, error_code = ?, error_message = ?,
            updated_at = ?, terminal_at = ?
           WHERE id = ?`,
        )
        .run(
          state,
          optional(input.relutionState, current.relution_state),
          optional(input.relutionActionUuid, current.relution_action_uuid),
          optionalTime(
            input.correlationStartedAt,
            current.correlation_started_at,
          ),
          optionalTime(
            input.verificationDeadlineAt,
            current.verification_deadline_at,
          ),
          optionalTime(input.submittedAt, current.submitted_at),
          optional(input.errorCode, current.error_code),
          optional(input.errorMessage, current.error_message),
          now,
          terminalAt,
          input.id,
        );
      const updated = this.getOwnedRow(input.id, input.owner);
      if (!updated) throw new Error("Updated action could not be read back.");
      this.insertAuditEvent(
        updated,
        input.event ?? "state_changed",
        input.details ?? {},
        now,
      );
      return toAction(updated);
    });
  }

  listRecentActions(
    owner: Pick<ActionOwner, "issuer" | "subject">,
    limit = 20,
  ) {
    validateOwner(owner);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Recent action limit must be from 1 to 100.");
    }
    return this.database
      .prepare(
        `SELECT * FROM actions
         WHERE owner_issuer = ? AND owner_subject = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(owner.issuer, owner.subject, limit)
      .map((row) => toAction(row as unknown as ActionRow));
  }

  listAuditEvents(
    owner: Pick<ActionOwner, "issuer" | "subject">,
    actionId: string,
  ): AuditEvent[] {
    validateOwner(owner);
    return this.database
      .prepare(
        `SELECT audit_events.* FROM audit_events
         JOIN actions ON actions.id = audit_events.action_id
         WHERE actions.id = ? AND actions.owner_issuer = ?
           AND actions.owner_subject = ?
         ORDER BY audit_events.id`,
      )
      .all(actionId, owner.issuer, owner.subject)
      .map((row) => toAuditEvent(row as unknown as AuditRow));
  }

  getRateLimit(
    owner: Pick<ActionOwner, "issuer" | "subject">,
    now = this.now(),
  ): RateLimitStatus {
    validateOwner(owner);
    const since = now - RATE_WINDOW_MS;
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count, MIN(created_at) AS oldest
         FROM actions WHERE owner_issuer = ? AND owner_subject = ?
           AND created_at > ?`,
      )
      .get(owner.issuer, owner.subject, since) as {
      count: number;
      oldest: number | null;
    };
    return {
      allowed: row.count < RATE_LIMIT,
      remaining: Math.max(0, RATE_LIMIT - row.count),
      resetAt: row.oldest === null ? null : timestamp(row.oldest + RATE_WINDOW_MS),
    };
  }

  cleanup(retentionDays = 90, now = this.now()) {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1_000;
    return this.transaction(() => {
      this.database
        .prepare(
          `DELETE FROM audit_events WHERE action_id IN (
            SELECT id FROM actions
            WHERE state IN ('succeeded', 'failed', 'cancelled')
              AND terminal_at < ?
          )`,
        )
        .run(cutoff);
      const result = this.database
        .prepare(
          `DELETE FROM actions
           WHERE state IN ('succeeded', 'failed', 'cancelled')
             AND terminal_at < ?`,
        )
        .run(cutoff);
      return Number(result.changes);
    });
  }

  createNativeAuthRequest(input: CreateNativeAuthRequestInput): NativeAuthRequest {
    validateNativeAuthRequest(input);
    const now = this.now();
    return this.transaction(() => {
      this.database
        .prepare("DELETE FROM native_auth_requests WHERE expires_at <= ?")
        .run(now);
      const existing = this.getNativeAuthRequestRow(input.requestId);
      if (existing) {
        if (
          existing.status === "pending" &&
          existing.expires_at > now &&
          existing.verifier_challenge === input.challenge &&
          existing.state_hash === input.stateHash &&
          existing.loopback_port === input.loopbackPort
        ) {
          return toNativeAuthRequest(existing);
        }
        throw new NativeAuthRequestConflictError();
      }
      const pending = this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM native_auth_requests
           WHERE status IN ('pending', 'authorized') AND expires_at > ?`,
        )
        .get(now) as { count: number };
      if (pending.count >= NATIVE_PENDING_REQUEST_LIMIT) {
        throw new NativeAuthCapacityError();
      }
      this.database
        .prepare(
          `INSERT INTO native_auth_requests (
            request_id, verifier_challenge, state_hash, loopback_port, status,
            expires_at, created_at
          ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          input.requestId,
          input.challenge,
          input.stateHash,
          input.loopbackPort,
          now + NATIVE_AUTH_REQUEST_TTL_MS,
          now,
        );
      const row = this.getNativeAuthRequestRow(input.requestId);
      if (!row) throw new Error("Native authorization request could not be read back.");
      return toNativeAuthRequest(row);
    });
  }

  authorizeNativeAuthRequest(
    requestId: string,
    owner: PortalUser,
    codeHash: string,
  ): NativeAuthRequest | null {
    validateRequestId(requestId);
    validatePortalUser(owner);
    validateSecretHash(codeHash, "codeHash");
    const now = this.now();
    return this.transaction(() => {
      const current = this.getNativeAuthRequestRow(requestId);
      if (!current || current.status !== "pending" || current.expires_at <= now) {
        return null;
      }
      const updated = this.database
        .prepare(
          `UPDATE native_auth_requests SET
             status = 'authorized', owner_issuer = ?, owner_subject = ?,
             relution_username = ?, display_name = ?, code_hash = ?,
             code_expires_at = ?, authorized_at = ?
           WHERE request_id = ? AND status = 'pending' AND expires_at > ?`,
        )
        .run(
          owner.issuer,
          owner.subject,
          owner.relutionUsername,
          owner.displayName,
          codeHash,
          Math.min(current.expires_at, now + NATIVE_AUTH_CODE_TTL_MS),
          now,
          requestId,
          now,
        );
      if (updated.changes !== 1) return null;
      const row = this.getNativeAuthRequestRow(requestId);
      if (!row) throw new Error("Authorized native request could not be read back.");
      return toNativeAuthRequest(row);
    });
  }

  consumeNativeAuthRequest(
    requestId: string,
    codeHash: string,
    verifierChallenge: string,
  ): NativeAuthGrant | null {
    validateRequestId(requestId);
    validateSecretHash(codeHash, "codeHash");
    validateChallenge(verifierChallenge);
    const now = this.now();
    return this.transaction(() => {
      const current = this.getNativeAuthRequestRow(requestId);
      if (
        !current ||
        current.status !== "authorized" ||
        current.expires_at <= now ||
        current.code_expires_at === null ||
        current.code_expires_at <= now ||
        current.code_hash !== codeHash ||
        current.verifier_challenge !== verifierChallenge ||
        !current.owner_issuer ||
        !current.owner_subject ||
        !current.relution_username ||
        !current.display_name
      ) {
        return null;
      }
      const consumed = this.database
        .prepare(
          `UPDATE native_auth_requests SET status = 'consumed', code_hash = NULL,
             code_expires_at = NULL, consumed_at = ?
           WHERE request_id = ? AND status = 'authorized' AND code_hash = ?
             AND verifier_challenge = ? AND expires_at > ? AND code_expires_at > ?`,
        )
        .run(now, requestId, codeHash, verifierChallenge, now, now);
      if (consumed.changes !== 1) return null;
      return {
        requestId: current.request_id,
        loopbackPort: current.loopback_port,
        owner: {
          id: current.owner_subject,
          issuer: current.owner_issuer,
          subject: current.owner_subject,
          relutionUsername: current.relution_username,
          displayName: current.display_name,
        },
      };
    });
  }

  createNativeSession(input: CreateNativeSessionInput): NativeSession {
    validatePortalUser(input.owner);
    validateSecretHash(input.tokenHash, "tokenHash");
    if (
      !input.deviceUuid.trim() ||
      input.deviceUuid.length > 128 ||
      input.deviceUuid.includes("\0")
    ) {
      throw new Error("deviceUuid must be a bounded Relution identifier.");
    }
    validateSecretHash(input.evidenceDigest, "evidenceDigest");
    validateClientVersion(input.clientVersion);
    const now = this.now();
    return this.transaction(() => {
      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO native_sessions (
            id, token_hash, owner_issuer, owner_subject, relution_username, display_name,
            device_uuid, evidence_digest, client_version, created_at, last_seen_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.tokenHash,
          input.owner.issuer,
          input.owner.subject,
          input.owner.relutionUsername,
          input.owner.displayName,
          input.deviceUuid,
          input.evidenceDigest,
          input.clientVersion,
          now,
          now,
          now + NATIVE_SESSION_TTL_MS,
        );
      const active = this.database
        .prepare(
          `SELECT id FROM native_sessions
           WHERE owner_issuer = ? AND owner_subject = ? AND device_uuid = ?
             AND revoked_at IS NULL AND expires_at > ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(input.owner.issuer, input.owner.subject, input.deviceUuid, now) as Array<{
        id: string;
      }>;
      for (const session of active.slice(0, Math.max(0, active.length - NATIVE_SESSION_LIMIT))) {
        this.database
          .prepare("UPDATE native_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
          .run(now, session.id);
      }
      const row = this.getNativeSessionRow(id);
      if (!row) throw new Error("Native session could not be read back.");
      return toNativeSession(row);
    });
  }

  assertNativeIdentityBinding(
    owner: PortalUser,
    relutionUserUuid: string,
  ): void {
    validatePortalUser(owner);
    validateBoundedIdentifier(relutionUserUuid, "relutionUserUuid");
    const now = this.now();
    this.transaction(() => {
      const current = this.database
        .prepare(
          `SELECT relution_user_uuid FROM native_identity_bindings
           WHERE owner_issuer = ? AND owner_subject = ?`,
        )
        .get(owner.issuer, owner.subject) as
        | { relution_user_uuid: string }
        | undefined;
      if (current && current.relution_user_uuid !== relutionUserUuid) {
        throw new NativeIdentityBindingError();
      }
      const otherOwner = this.database
        .prepare(
          `SELECT 1 FROM native_identity_bindings
           WHERE relution_user_uuid = ?
             AND (owner_issuer <> ? OR owner_subject <> ?)`,
        )
        .get(relutionUserUuid, owner.issuer, owner.subject);
      if (otherOwner) {
        throw new NativeIdentityBindingError();
      }
      this.database
        .prepare(
          `INSERT INTO native_identity_bindings (
             owner_issuer, owner_subject, relution_user_uuid,
             relution_username, first_seen_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_issuer, owner_subject) DO UPDATE SET
             relution_username = excluded.relution_username,
             last_seen_at = excluded.last_seen_at`,
        )
        .run(
          owner.issuer,
          owner.subject,
          relutionUserUuid,
          owner.relutionUsername,
          now,
          now,
        );
    });
  }

  authenticateNativeSession(tokenHash: string): NativeSession | null {
    validateSecretHash(tokenHash, "tokenHash");
    const now = this.now();
    return this.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT * FROM native_sessions
           WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
        )
        .get(tokenHash, now) as NativeSessionRow | undefined;
      if (!row) return null;
      this.database
        .prepare("UPDATE native_sessions SET last_seen_at = ? WHERE id = ?")
        .run(now, row.id);
      row.last_seen_at = now;
      return toNativeSession(row);
    });
  }

  revokeNativeSession(tokenHash: string): boolean {
    validateSecretHash(tokenHash, "tokenHash");
    const now = this.now();
    return this.transaction(() =>
      this.database
        .prepare(
          "UPDATE native_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        )
        .run(now, tokenHash).changes === 1,
    );
  }

  revokeNativeSessions(
    scope:
      | { kind: "all" }
      | { kind: "user"; issuer: string; subject: string }
      | { kind: "device"; deviceUuid: string },
  ): number {
    const now = this.now();
    if (scope.kind === "user") {
      validateOwner(scope);
    } else if (scope.kind === "device") {
      validateBoundedIdentifier(scope.deviceUuid, "deviceUuid");
    }
    return this.transaction(() => {
      if (scope.kind === "all") {
        return Number(
          this.database
            .prepare(
              "UPDATE native_sessions SET revoked_at = ? WHERE revoked_at IS NULL",
            )
            .run(now).changes,
        );
      }
      if (scope.kind === "user") {
        return Number(
          this.database
            .prepare(
              `UPDATE native_sessions SET revoked_at = ?
               WHERE owner_issuer = ? AND owner_subject = ? AND revoked_at IS NULL`,
            )
            .run(now, scope.issuer, scope.subject).changes,
        );
      }
      return Number(
        this.database
          .prepare(
            `UPDATE native_sessions SET revoked_at = ?
             WHERE device_uuid = ? AND revoked_at IS NULL`,
          )
          .run(now, scope.deviceUuid).changes,
      );
    });
  }

  recordSecurityEvent(input: SecurityEventInput): void {
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(input.event)) {
      throw new Error("Security event type is invalid.");
    }
    if (!["success", "denied", "failure"].includes(input.outcome)) {
      throw new Error("Security event outcome is invalid.");
    }
    if (input.owner) validateOwner(input.owner);
    if (input.deviceUuid) {
      validateBoundedIdentifier(input.deviceUuid, "deviceUuid");
    }
    if (input.requestId) validateRequestId(input.requestId);
    this.database
      .prepare(
        `INSERT INTO security_events (
           event_type, outcome, owner_hash, device_hash, request_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.event,
        input.outcome,
        input.owner
          ? digestIdentifier(`${input.owner.issuer}\0${input.owner.subject}`)
          : null,
        input.deviceUuid ? digestIdentifier(input.deviceUuid) : null,
        input.requestId ?? null,
        this.now(),
      );
  }

  cleanupNativeAuth(now = this.now()): NativeAuthCleanupResult {
    return this.transaction(() => {
      const requests = this.database
        .prepare(
          `DELETE FROM native_auth_requests
           WHERE expires_at <= ? OR (status = 'consumed' AND consumed_at <= ?)`,
        )
        .run(now, now - NATIVE_AUTH_CODE_TTL_MS);
      const sessions = this.database
        .prepare(
          `DELETE FROM native_sessions
           WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)`,
        )
        .run(now, now - NATIVE_SESSION_TTL_MS);
      this.database
        .prepare("DELETE FROM security_events WHERE created_at <= ?")
        .run(now - 90 * 24 * 60 * 60 * 1_000);
      return { requests: Number(requests.changes), sessions: Number(sessions.changes) };
    });
  }

  private migrate() {
    const row = this.database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (row.user_version > 5) {
      throw new Error(
        `Database schema version ${row.user_version} is newer than supported.`,
      );
    }
    let version = row.user_version;
    if (version === 0) {
      this.transaction(() => {
        this.database.exec(`
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
          UNIQUE (owner_issuer, owner_subject, idempotency_hash)
        );
        CREATE UNIQUE INDEX actions_active_reservation
          ON actions(device_uuid, app_uuid)
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
        PRAGMA user_version = 2;
      `);
      });
      version = 2;
    }
    if (version === 1) {
      const activeConflict = this.database
        .prepare(
          `SELECT device_uuid, app_uuid, COUNT(*) AS count
           FROM actions
           WHERE state IN (
             'reserved', 'queued', 'sent', 'deferred', 'verifying', 'unknown'
           )
           GROUP BY device_uuid, app_uuid
           HAVING COUNT(*) > 1
           LIMIT 1`,
        )
        .get();
      if (activeConflict) {
        throw new Error(
          "Database migration requires operator reconciliation: multiple active actions exist for one device and app.",
        );
      }
      const idempotencyConflict = this.database
        .prepare(
          `SELECT owner_issuer, owner_subject, idempotency_hash, COUNT(*) AS count
           FROM actions
           GROUP BY owner_issuer, owner_subject, idempotency_hash
           HAVING COUNT(*) > 1
           LIMIT 1`,
        )
        .get();
      if (idempotencyConflict) {
        throw new Error(
          "Database migration requires operator reconciliation: an owner reused an idempotency key for different requests.",
        );
      }
      this.transaction(() => {
        this.database.exec(`
          DROP INDEX actions_active_reservation;
          CREATE UNIQUE INDEX actions_active_reservation
            ON actions(device_uuid, app_uuid)
            WHERE state IN (
              'reserved', 'queued', 'sent', 'deferred', 'verifying', 'unknown'
            );
          CREATE UNIQUE INDEX actions_owner_idempotency
            ON actions(owner_issuer, owner_subject, idempotency_hash);
          PRAGMA user_version = 2;
        `);
      });
      version = 2;
    }
    if (version === 2) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE native_auth_requests (
            request_id TEXT PRIMARY KEY,
            verifier_challenge TEXT NOT NULL,
            state_hash TEXT NOT NULL CHECK (length(state_hash) = 64),
            loopback_port INTEGER NOT NULL CHECK (loopback_port BETWEEN 1024 AND 65535),
            status TEXT NOT NULL CHECK (status IN ('pending', 'authorized', 'consumed')),
            owner_issuer TEXT,
            owner_subject TEXT,
            relution_username TEXT,
            display_name TEXT,
            code_hash TEXT CHECK (code_hash IS NULL OR length(code_hash) = 64),
            expires_at INTEGER NOT NULL,
            code_expires_at INTEGER,
            created_at INTEGER NOT NULL,
            authorized_at INTEGER,
            consumed_at INTEGER,
            CHECK (
              (status = 'pending' AND owner_issuer IS NULL AND owner_subject IS NULL
               AND relution_username IS NULL AND display_name IS NULL
               AND code_hash IS NULL AND code_expires_at IS NULL)
              OR
              (status = 'authorized' AND owner_issuer IS NOT NULL AND owner_subject IS NOT NULL
               AND relution_username IS NOT NULL AND display_name IS NOT NULL
               AND code_hash IS NOT NULL AND code_expires_at IS NOT NULL)
              OR
              (status = 'consumed' AND owner_issuer IS NOT NULL AND owner_subject IS NOT NULL
               AND relution_username IS NOT NULL AND display_name IS NOT NULL
               AND code_hash IS NULL AND code_expires_at IS NULL
               AND consumed_at IS NOT NULL)
            )
          );
          CREATE INDEX native_auth_requests_expiry ON native_auth_requests(expires_at);
          CREATE TABLE native_sessions (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
            owner_issuer TEXT NOT NULL,
            owner_subject TEXT NOT NULL,
            relution_username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            device_uuid TEXT NOT NULL,
            evidence_digest TEXT NOT NULL CHECK (length(evidence_digest) = 64),
            client_version TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            revoked_at INTEGER
          );
          CREATE INDEX native_sessions_active_owner_device
            ON native_sessions(owner_issuer, owner_subject, device_uuid, created_at)
            WHERE revoked_at IS NULL;
          CREATE INDEX native_sessions_expiry ON native_sessions(expires_at);
          PRAGMA user_version = 3;
        `);
      });
      version = 3;
    }
    if (version === 3) {
      this.transaction(() => {
        this.database
          .prepare(
            `UPDATE native_sessions
             SET revoked_at = ?
             WHERE revoked_at IS NULL`,
          )
          .run(this.now());
        this.database.exec(`
          CREATE TABLE native_identity_bindings (
            owner_issuer TEXT NOT NULL,
            owner_subject TEXT NOT NULL,
            relution_user_uuid TEXT NOT NULL UNIQUE,
            relution_username TEXT NOT NULL,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            PRIMARY KEY (owner_issuer, owner_subject)
          );
          PRAGMA user_version = 4;
        `);
      });
      version = 4;
    }
    if (version === 4) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE security_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
            owner_hash TEXT CHECK (owner_hash IS NULL OR length(owner_hash) = 64),
            device_hash TEXT CHECK (device_hash IS NULL OR length(device_hash) = 64),
            request_id TEXT,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX security_events_created ON security_events(created_at);
          CREATE INDEX security_events_type_created
            ON security_events(event_type, created_at);
          PRAGMA user_version = 5;
        `);
      });
    }
  }

  private findByIdempotency(input: ReserveActionInput, hash: string) {
    return (this.database
      .prepare(
        `SELECT * FROM actions
         WHERE owner_issuer = ? AND owner_subject = ?
           AND idempotency_hash = ?`,
      )
      .get(
        input.owner.issuer,
        input.owner.subject,
        hash,
      ) ?? null) as ActionRow | null;
  }

  private findActive(input: ReserveActionInput) {
    return (this.database
      .prepare(
        `SELECT * FROM actions
         WHERE device_uuid = ? AND app_uuid = ?
           AND state IN (
             'reserved', 'queued', 'sent', 'deferred', 'verifying', 'unknown'
           )
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(input.deviceId, input.appId) ?? null) as
      | ActionRow
      | null;
  }

  private getOwnedRow(
    id: string,
    owner: Pick<ActionOwner, "issuer" | "subject">,
  ) {
    return (this.database
      .prepare(
        `SELECT * FROM actions
         WHERE id = ? AND owner_issuer = ? AND owner_subject = ?`,
      )
      .get(id, owner.issuer, owner.subject) ?? null) as ActionRow | null;
  }

  private getNativeAuthRequestRow(requestId: string): NativeAuthRequestRow | null {
    return (this.database
      .prepare("SELECT * FROM native_auth_requests WHERE request_id = ?")
      .get(requestId) ?? null) as NativeAuthRequestRow | null;
  }

  private getNativeSessionRow(id: string): NativeSessionRow | null {
    return (this.database
      .prepare("SELECT * FROM native_sessions WHERE id = ?")
      .get(id) ?? null) as NativeSessionRow | null;
  }

  private insertAuditEvent(
    row: ActionRow,
    event: string,
    details: Record<string, string | number | boolean | null>,
    createdAt: number,
  ) {
    this.database
      .prepare(
        `INSERT INTO audit_events (
          action_id, owner_issuer, owner_subject, relution_username,
          event_type, outcome, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.owner_issuer,
        row.owner_subject,
        row.relution_username,
        event,
        row.state,
        JSON.stringify(details),
        createdAt,
      );
  }

  private transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function createActionRepository(
  databasePath: string,
  now?: () => number,
) {
  return new SqliteActionRepository(databasePath, now);
}

function assertAbsoluteDatabasePath(databasePath: string) {
  if (!databasePath || !isAbsolute(databasePath) || databasePath.includes("\0")) {
    throw new Error("Database path must be an absolute path.");
  }
}

function ensureDatabaseDirectory(databasePath: string) {
  const parent = dirname(databasePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  } else {
    chmodSync(parent, 0o700);
  }
}

function validateReserveInput(input: ReserveActionInput) {
  validateOwner(input.owner);
  for (const [name, value] of Object.entries({
    deviceId: input.deviceId,
    appId: input.appId,
    targetVersionId: input.targetVersionId,
    idempotencyKey: input.idempotencyKey,
  })) {
    if (!value?.trim()) throw new Error(`${name} is required.`);
  }
  if (input.idempotencyKey.length > 128) {
    throw new Error("idempotencyKey is too long.");
  }
  if (input.intent !== "install" && input.intent !== "update") {
    throw new Error("Intent must be install or update.");
  }
}

function sameRequest(row: ActionRow, input: ReserveActionInput) {
  return (
    row.device_uuid === input.deviceId &&
    row.app_uuid === input.appId &&
    row.target_version_uuid === input.targetVersionId &&
    row.installed_version_uuid === input.installedVersionId &&
    row.package_identifier === input.packageIdentifier &&
    row.intent === input.intent
  );
}

function validateOwner(owner: Pick<ActionOwner, "issuer" | "subject">) {
  if (!owner.issuer?.trim() || !owner.subject?.trim()) {
    throw new Error("Action owner issuer and subject are required.");
  }
}

function validateBoundedIdentifier(value: string, name: string) {
  if (!value?.trim() || value.length > 128 || value.includes("\0")) {
    throw new Error(`${name} must be a bounded identifier.`);
  }
}

function digestIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function optional<T>(value: T | undefined, current: T) {
  return value === undefined ? current : value;
}

function optionalTime(
  value: string | null | undefined,
  current: number | null,
) {
  if (value === undefined) return current;
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error("Invalid action timestamp.");
  return parsed;
}

function isStoredState(value: string): value is StoredActionState {
  return (
    ACTIVE_STATES.has(value as StoredActionState) ||
    TERMINAL_STATES.has(value as StoredActionState)
  );
}

function toAction(row: ActionRow): PersistedAction {
  return {
    id: row.id,
    owner: {
      issuer: row.owner_issuer,
      subject: row.owner_subject,
      relutionUsername: row.relution_username,
    },
    deviceId: row.device_uuid,
    appId: row.app_uuid,
    targetVersionId: row.target_version_uuid,
    installedVersionId: row.installed_version_uuid,
    packageIdentifier: row.package_identifier,
    intent: row.intent,
    state: row.state,
    relutionState: row.relution_state,
    relutionActionUuid: row.relution_action_uuid,
    correlationStartedAt: optionalTimestamp(row.correlation_started_at),
    verificationDeadlineAt: optionalTimestamp(row.verification_deadline_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: timestamp(row.created_at),
    submittedAt: optionalTimestamp(row.submitted_at),
    updatedAt: timestamp(row.updated_at),
    terminalAt: optionalTimestamp(row.terminal_at),
  };
}

function toAuditEvent(row: AuditRow): AuditEvent {
  let details: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.details_json) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      details = parsed as Record<string, unknown>;
    }
  } catch {
    details = {};
  }
  return {
    id: row.id,
    actionId: row.action_id,
    event: row.event_type,
    outcome: row.outcome,
    details,
    createdAt: timestamp(row.created_at),
  };
}

function timestamp(value: number) {
  return new Date(value).toISOString();
}

function optionalTimestamp(value: number | null) {
  return value === null ? null : timestamp(value);
}

function toNativeAuthRequest(row: NativeAuthRequestRow): NativeAuthRequest {
  return {
    requestId: row.request_id,
    challenge: row.verifier_challenge,
    stateHash: row.state_hash,
    loopbackPort: row.loopback_port,
    status: row.status,
    owner:
      row.owner_issuer &&
      row.owner_subject &&
      row.relution_username &&
      row.display_name
        ? {
            issuer: row.owner_issuer,
            subject: row.owner_subject,
            relutionUsername: row.relution_username,
          }
        : null,
    expiresAt: timestamp(row.expires_at),
    codeExpiresAt: optionalTimestamp(row.code_expires_at),
    createdAt: timestamp(row.created_at),
    authorizedAt: optionalTimestamp(row.authorized_at),
    consumedAt: optionalTimestamp(row.consumed_at),
  };
}

function toNativeSession(row: NativeSessionRow): NativeSession {
  return {
    id: row.id,
    owner: {
      id: row.owner_subject,
      issuer: row.owner_issuer,
      subject: row.owner_subject,
      relutionUsername: row.relution_username,
      displayName: row.display_name,
    },
    deviceUuid: row.device_uuid,
    evidenceDigest: row.evidence_digest,
    clientVersion: row.client_version,
    createdAt: timestamp(row.created_at),
    lastSeenAt: timestamp(row.last_seen_at),
    expiresAt: timestamp(row.expires_at),
    revokedAt: optionalTimestamp(row.revoked_at),
  };
}

function validateNativeAuthRequest(input: CreateNativeAuthRequestInput) {
  validateRequestId(input.requestId);
  validateChallenge(input.challenge);
  validateSecretHash(input.stateHash, "stateHash");
  if (!Number.isInteger(input.loopbackPort) || input.loopbackPort < 1024 || input.loopbackPort > 65535) {
    throw new Error("loopbackPort must be an integer from 1024 to 65535.");
  }
}

function validateRequestId(value: string) {
  validateUuid(value, "requestId");
}

function validateUuid(value: string, name: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
}

function validateChallenge(value: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(value)) {
    throw new Error("challenge must be a PKCE verifier challenge.");
  }
}

function validateSecretHash(value: string, name: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 hash.`);
  }
}

function validatePortalUser(user: PortalUser) {
  validateOwner(user);
  if (!user.relutionUsername?.trim() || user.relutionUsername.length > 256) {
    throw new Error("Portal user Relution username is required.");
  }
}

function validateClientVersion(value: string) {
  if (!/^[0-9A-Za-z.+-]{1,128}$/.test(value)) {
    throw new Error("clientVersion must be 1 to 128 version characters.");
  }
}
