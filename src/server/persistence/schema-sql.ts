export const INITIAL_SCHEMA_SQL = `
  CREATE TABLE actions (
    id TEXT PRIMARY KEY, owner_issuer TEXT NOT NULL, owner_subject TEXT NOT NULL,
    relution_username TEXT NOT NULL, device_uuid TEXT NOT NULL, app_uuid TEXT NOT NULL,
    target_version_uuid TEXT NOT NULL, installed_version_uuid TEXT, package_identifier TEXT,
    intent TEXT NOT NULL CHECK (intent IN ('install', 'update')),
    idempotency_hash TEXT NOT NULL CHECK (length(idempotency_hash) = 64),
    state TEXT NOT NULL CHECK (state IN ('reserved', 'queued', 'sent', 'deferred', 'verifying', 'succeeded', 'failed', 'cancelled', 'unknown')),
    relution_state TEXT, relution_action_uuid TEXT, correlation_started_at INTEGER,
    verification_deadline_at INTEGER, error_code TEXT, error_message TEXT,
    created_at INTEGER NOT NULL, submitted_at INTEGER, updated_at INTEGER NOT NULL, terminal_at INTEGER,
    UNIQUE (owner_issuer, owner_subject, idempotency_hash)
  );
  CREATE UNIQUE INDEX actions_active_reservation ON actions(device_uuid, app_uuid)
    WHERE state IN ('reserved', 'queued', 'sent', 'deferred', 'verifying', 'unknown');
  CREATE INDEX actions_owner_created ON actions(owner_issuer, owner_subject, created_at DESC);
  CREATE INDEX actions_terminal ON actions(terminal_at) WHERE terminal_at IS NOT NULL;
  CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
    owner_issuer TEXT NOT NULL, owner_subject TEXT NOT NULL, relution_username TEXT NOT NULL,
    event_type TEXT NOT NULL, outcome TEXT NOT NULL, details_json TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX audit_events_action ON audit_events(action_id, id);
  PRAGMA user_version = 2;
`;

export const NATIVE_AUTH_SCHEMA_SQL = `
  CREATE TABLE native_auth_requests (
    request_id TEXT PRIMARY KEY, verifier_challenge TEXT NOT NULL,
    state_hash TEXT NOT NULL CHECK (length(state_hash) = 64),
    loopback_port INTEGER NOT NULL CHECK (loopback_port BETWEEN 1024 AND 65535),
    status TEXT NOT NULL CHECK (status IN ('pending', 'authorized', 'consumed')),
    owner_issuer TEXT, owner_subject TEXT, relution_username TEXT, display_name TEXT,
    code_hash TEXT CHECK (code_hash IS NULL OR length(code_hash) = 64), expires_at INTEGER NOT NULL,
    code_expires_at INTEGER, created_at INTEGER NOT NULL, authorized_at INTEGER, consumed_at INTEGER,
    CHECK ((status = 'pending' AND owner_issuer IS NULL AND owner_subject IS NULL AND relution_username IS NULL AND display_name IS NULL AND code_hash IS NULL AND code_expires_at IS NULL)
      OR (status = 'authorized' AND owner_issuer IS NOT NULL AND owner_subject IS NOT NULL AND relution_username IS NOT NULL AND display_name IS NOT NULL AND code_hash IS NOT NULL AND code_expires_at IS NOT NULL)
      OR (status = 'consumed' AND owner_issuer IS NOT NULL AND owner_subject IS NOT NULL AND relution_username IS NOT NULL AND display_name IS NOT NULL AND code_hash IS NULL AND code_expires_at IS NULL AND consumed_at IS NOT NULL))
  );
  CREATE INDEX native_auth_requests_expiry ON native_auth_requests(expires_at);
  CREATE TABLE native_sessions (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    owner_issuer TEXT NOT NULL, owner_subject TEXT NOT NULL, relution_username TEXT NOT NULL,
    display_name TEXT NOT NULL, device_uuid TEXT NOT NULL,
    evidence_digest TEXT NOT NULL CHECK (length(evidence_digest) = 64), client_version TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
  );
  CREATE INDEX native_sessions_active_owner_device ON native_sessions(owner_issuer, owner_subject, device_uuid, created_at) WHERE revoked_at IS NULL;
  CREATE INDEX native_sessions_expiry ON native_sessions(expires_at);
  PRAGMA user_version = 3;
`;
