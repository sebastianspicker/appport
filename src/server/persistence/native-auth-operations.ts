import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { PortalUser } from "@/domain/models";
import {
  NativeAuthCapacityError,
  NativeAuthRequestConflictError,
  NativeIdentityBindingError,
} from "./repository";
import type {
  CreateNativeAuthRequestInput,
  CreateNativeSessionInput,
  NativeAuthCleanupResult,
  NativeAuthGrant,
  NativeAuthRequest,
  NativeAuthRequestRow,
  NativeSession,
  NativeSessionRow,
  SecurityEventInput,
} from "./repository";
import {
  canConsumeNativeAuthRequest,
  digestIdentifier,
  isReplayOfNativeAuthRequest,
  toNativeAuthGrant,
  toNativeAuthRequest,
  toNativeSession,
  validateBoundedIdentifier,
  validateChallenge,
  validateClientVersion,
  validateNativeAuthRequest,
  validateOwner,
  validatePortalUser,
  validateRequestId,
  validateSecretHash,
} from "./repository-support";

const NATIVE_AUTH_REQUEST_TTL_MS = 5 * 60 * 1_000;
const NATIVE_AUTH_CODE_TTL_MS = 2 * 60 * 1_000;
const NATIVE_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const NATIVE_SESSION_LIMIT = 3;
const NATIVE_PENDING_REQUEST_LIMIT = 1_000;

export class NativeAuthOperations {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number,
    private readonly transaction: <T>(work: () => T) => T,
  ) {}

createNativeAuthRequest(input: CreateNativeAuthRequestInput): NativeAuthRequest {
  validateNativeAuthRequest(input);
  const now = this.now();
  return this.transaction(() => {
    this.database
      .prepare("DELETE FROM native_auth_requests WHERE expires_at <= ?")
      .run(now);
    const existing = this.getNativeAuthRequestRow(input.requestId);
    if (existing) {
      if (isReplayOfNativeAuthRequest(existing, input, now)) {
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
    if (!canConsumeNativeAuthRequest(current, codeHash, verifierChallenge, now)) {
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
    return toNativeAuthGrant(current);
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
}
