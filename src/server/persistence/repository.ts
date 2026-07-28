import { createHash, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { PortalUser } from "@/domain/models";
import {
  ActionReservationConflictError,
  RateLimitExceededError,
} from "./repository-contracts";
import type {
  ActionOwner,
  ActionRow,
  AuditEvent,
  AuditRow,
  CreateNativeAuthRequestInput,
  CreateNativeSessionInput,
  PersistedAction,
  RateLimitStatus,
  ReservationResult,
  ReserveActionInput,
  SecurityEventInput,
  StoredActionState,
  UpdateActionInput,
} from "./repository-contracts";
export {
  ActionReservationConflictError,
  NativeAuthCapacityError,
  NativeAuthRequestConflictError,
  NativeIdentityBindingError,
  RateLimitExceededError,
} from "./repository-contracts";
export type {
  ActionOwner,
  ActionRow,
  AuditEvent,
  AuditRow,
  CreateNativeAuthRequestInput,
  CreateNativeSessionInput,
  NativeAuthCleanupResult,
  NativeAuthGrant,
  NativeAuthRequest,
  NativeAuthRequestRow,
  NativeSession,
  NativeSessionRow,
  PersistedAction,
  RateLimitStatus,
  ReservationResult,
  ReserveActionInput,
  SecurityEventInput,
  StoredActionState,
  UpdateActionInput,
} from "./repository-contracts";
import { migrateDatabase } from "./schema-migrations";
import { NativeAuthOperations } from "./native-auth-operations";
import {
  actionDetails,
  actionEvent,
  assertAbsoluteDatabasePath,
  ensureDatabaseDirectory,
  isStoredState,
  resolveActionUpdate,
  sameRequest,
  timestamp,
  toAction,
  toAuditEvent,
  validateOwner,
  validateReserveInput,
} from "./repository-support";

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
export const ACTIVE_STATES = new Set<StoredActionState>([
  "reserved",
  "queued",
  "sent",
  "deferred",
  "verifying",
  "unknown",
]);
export const TERMINAL_STATES = new Set<StoredActionState>([
  "succeeded",
  "failed",
  "cancelled",
]);
export const ACTION_UPDATE_SQL = `UPDATE actions SET
  state = ?, relution_state = ?, relution_action_uuid = ?,
  correlation_started_at = ?, verification_deadline_at = ?,
  submitted_at = ?, error_code = ?, error_message = ?,
  updated_at = ?, terminal_at = ?
 WHERE id = ?`;


/** Synchronous and server-only. Never wrap network I/O in repository calls. */
export class SqliteActionRepository {
  private readonly database: DatabaseSync;
  private readonly nativeAuth: NativeAuthOperations;

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
    migrateDatabase(this.database, this.now, (work) => this.transaction(work));
    this.nativeAuth = new NativeAuthOperations(
      this.database,
      this.now,
      (work) => this.transaction(work),
    );
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
      const existing = this.findExistingReservation(input, hash);
      if (existing) return existing;
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

  private findExistingReservation(
    input: ReserveActionInput,
    hash: string,
  ): ReservationResult | null {
    const duplicate = this.findByIdempotency(input, hash);
    if (duplicate) {
      if (!sameRequest(duplicate, input)) {
        throw new ActionReservationConflictError("idempotency_key_reused");
      }
      return { action: toAction(duplicate), created: false, reason: "idempotent" };
    }
    const active = this.findActive(input);
    if (!active) return null;
    if (
      active.owner_issuer !== input.owner.issuer ||
      active.owner_subject !== input.owner.subject ||
      !sameRequest(active, input)
    ) {
      throw new ActionReservationConflictError("action_already_active");
    }
    return { action: toAction(active), created: false, reason: "active" };
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

    return this.transaction(() => this.updateExistingAction(input));
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

  createNativeAuthRequest(input: CreateNativeAuthRequestInput) {
    return this.nativeAuth.createNativeAuthRequest(input);
  }

  authorizeNativeAuthRequest(requestId: string, owner: PortalUser, codeHash: string) {
    return this.nativeAuth.authorizeNativeAuthRequest(requestId, owner, codeHash);
  }

  consumeNativeAuthRequest(requestId: string, codeHash: string, verifierChallenge: string) {
    return this.nativeAuth.consumeNativeAuthRequest(requestId, codeHash, verifierChallenge);
  }

  createNativeSession(input: CreateNativeSessionInput) {
    return this.nativeAuth.createNativeSession(input);
  }

  assertNativeIdentityBinding(owner: PortalUser, relutionUserUuid: string): void {
    this.nativeAuth.assertNativeIdentityBinding(owner, relutionUserUuid);
  }

  authenticateNativeSession(tokenHash: string) {
    return this.nativeAuth.authenticateNativeSession(tokenHash);
  }

  revokeNativeSession(tokenHash: string) {
    return this.nativeAuth.revokeNativeSession(tokenHash);
  }

  revokeNativeSessions(scope: Parameters<NativeAuthOperations["revokeNativeSessions"]>[0]) {
    return this.nativeAuth.revokeNativeSessions(scope);
  }

  recordSecurityEvent(input: SecurityEventInput): void {
    this.nativeAuth.recordSecurityEvent(input);
  }

  cleanupNativeAuth(now = this.now()) {
    return this.nativeAuth.cleanupNativeAuth(now);
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

  private updateExistingAction(input: UpdateActionInput): PersistedAction | null {
    const current = this.getOwnedRow(input.id, input.owner);
    if (!current) return null;
    const now = this.now();
    const values = resolveActionUpdate(input, current, now);
    this.database.prepare(ACTION_UPDATE_SQL).run(...values, input.id);
    const updated = this.getOwnedRow(input.id, input.owner);
    if (!updated) throw new Error("Updated action could not be read back.");
    this.insertAuditEvent(updated, actionEvent(input), actionDetails(input), now);
    return toAction(updated);
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
