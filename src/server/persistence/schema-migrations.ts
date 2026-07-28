import { DatabaseSync } from "node:sqlite";
import { INITIAL_SCHEMA_SQL, NATIVE_AUTH_SCHEMA_SQL } from "./schema-sql";

export function migrateDatabase(
  database: DatabaseSync,
  now: () => number,
  transaction: <T>(work: () => T) => T,
) {
  const row = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (row.user_version > 5) {
    throw new Error(
      `Database schema version ${row.user_version} is newer than supported.`,
    );
  }
  let version = row.user_version;
  if (version === 0) {
    transaction(() => {
      database.exec(INITIAL_SCHEMA_SQL);
    });
    version = 2;
  }
  if (version === 1) {
    const activeConflict = database
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
    const idempotencyConflict = database
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
    transaction(() => {
      database.exec(`
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
    transaction(() => {
      database.exec(NATIVE_AUTH_SCHEMA_SQL);
    });
    version = 3;
  }
  if (version === 3) {
    transaction(() => {
      database
        .prepare(
          `UPDATE native_sessions
           SET revoked_at = ?
           WHERE revoked_at IS NULL`,
        )
        .run(now());
      database.exec(`
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
    transaction(() => {
      database.exec(`
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

