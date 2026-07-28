import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { PortalUser } from "@/domain/models";
import type {
  ActionOwner,
  ActionRow,
  AuditEvent,
  AuditRow,
  CreateNativeAuthRequestInput,
  NativeAuthGrant,
  NativeAuthRequest,
  NativeAuthRequestRow,
  NativeSession,
  NativeSessionRow,
  PersistedAction,
  ReserveActionInput,
  StoredActionState,
  UpdateActionInput,
} from "./repository";
import { ACTIVE_STATES, TERMINAL_STATES } from "./repository";

export function assertAbsoluteDatabasePath(databasePath: string) {
  if (!databasePath || !isAbsolute(databasePath) || databasePath.includes("\0")) {
    throw new Error("Database path must be an absolute path.");
  }
}

export function ensureDatabaseDirectory(databasePath: string) {
  const parent = dirname(databasePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  } else {
    chmodSync(parent, 0o700);
  }
}

export function validateReserveInput(input: ReserveActionInput) {
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

export function sameRequest(row: ActionRow, input: ReserveActionInput) {
  return (
    row.device_uuid === input.deviceId &&
    row.app_uuid === input.appId &&
    row.target_version_uuid === input.targetVersionId &&
    row.installed_version_uuid === input.installedVersionId &&
    row.package_identifier === input.packageIdentifier &&
    row.intent === input.intent
  );
}

export function validateOwner(owner: Pick<ActionOwner, "issuer" | "subject">) {
  if (!owner.issuer?.trim() || !owner.subject?.trim()) {
    throw new Error("Action owner issuer and subject are required.");
  }
}

export function validateBoundedIdentifier(value: string, name: string) {
  if (!value?.trim() || value.length > 128 || value.includes("\0")) {
    throw new Error(`${name} must be a bounded identifier.`);
  }
}

export function digestIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function optional<T>(value: T | undefined, current: T) {
  return value === undefined ? current : value;
}

export function optionalTime(
  value: string | null | undefined,
  current: number | null,
) {
  if (value === undefined) return current;
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error("Invalid action timestamp.");
  return parsed;
}

export function resolveActionUpdate(
  input: UpdateActionInput,
  current: ActionRow,
  now: number,
) {
  const state = optional(input.state, current.state);
  return [
    state,
    optional(input.relutionState, current.relution_state),
    optional(input.relutionActionUuid, current.relution_action_uuid),
    optionalTime(input.correlationStartedAt, current.correlation_started_at),
    optionalTime(input.verificationDeadlineAt, current.verification_deadline_at),
    optionalTime(input.submittedAt, current.submitted_at),
    optional(input.errorCode, current.error_code),
    optional(input.errorMessage, current.error_message),
    now,
    terminalTimestamp(state, current.terminal_at, now),
  ] as const;
}

export function terminalTimestamp(
  state: StoredActionState,
  current: number | null,
  now: number,
) {
  return TERMINAL_STATES.has(state) ? current ?? now : null;
}

export function actionEvent(input: UpdateActionInput) {
  return optional(input.event, "state_changed");
}

export function actionDetails(input: UpdateActionInput) {
  return optional(input.details, {});
}

export function isStoredState(value: string): value is StoredActionState {
  return (
    ACTIVE_STATES.has(value as StoredActionState) ||
    TERMINAL_STATES.has(value as StoredActionState)
  );
}

export function toAction(row: ActionRow): PersistedAction {
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

export function toAuditEvent(row: AuditRow): AuditEvent {
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

export function timestamp(value: number) {
  return new Date(value).toISOString();
}

export function optionalTimestamp(value: number | null) {
  return value === null ? null : timestamp(value);
}

export function toNativeAuthRequest(row: NativeAuthRequestRow): NativeAuthRequest {
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

export function isReplayOfNativeAuthRequest(
  row: NativeAuthRequestRow,
  input: CreateNativeAuthRequestInput,
  now: number,
) {
  return [
    row.status === "pending",
    row.expires_at > now,
    row.verifier_challenge === input.challenge,
    row.state_hash === input.stateHash,
    row.loopback_port === input.loopbackPort,
  ].every(Boolean);
}

export function canConsumeNativeAuthRequest(
  row: NativeAuthRequestRow | null,
  codeHash: string,
  verifierChallenge: string,
  now: number,
): row is NativeAuthRequestRow & {
  owner_issuer: string;
  owner_subject: string;
  relution_username: string;
  display_name: string;
} {
  if (!row) return false;
  return [
    row.status === "authorized",
    row.expires_at > now,
    row.code_expires_at !== null,
    row.code_expires_at !== null && row.code_expires_at > now,
    row.code_hash === codeHash,
    row.verifier_challenge === verifierChallenge,
    Boolean(row.owner_issuer),
    Boolean(row.owner_subject),
    Boolean(row.relution_username),
    Boolean(row.display_name),
  ].every(Boolean);
}

export function toNativeAuthGrant(
  row: NativeAuthRequestRow & {
    owner_issuer: string;
    owner_subject: string;
    relution_username: string;
    display_name: string;
  },
): NativeAuthGrant {
  return {
    requestId: row.request_id,
    loopbackPort: row.loopback_port,
    owner: {
      id: row.owner_subject,
      issuer: row.owner_issuer,
      subject: row.owner_subject,
      relutionUsername: row.relution_username,
      displayName: row.display_name,
    },
  };
}

export function toNativeSession(row: NativeSessionRow): NativeSession {
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

export function validateNativeAuthRequest(input: CreateNativeAuthRequestInput) {
  validateRequestId(input.requestId);
  validateChallenge(input.challenge);
  validateSecretHash(input.stateHash, "stateHash");
  if (!Number.isInteger(input.loopbackPort) || input.loopbackPort < 1024 || input.loopbackPort > 65535) {
    throw new Error("loopbackPort must be an integer from 1024 to 65535.");
  }
}

export function validateRequestId(value: string) {
  validateUuid(value, "requestId");
}

export function validateUuid(value: string, name: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
}

export function validateChallenge(value: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(value)) {
    throw new Error("challenge must be a PKCE verifier challenge.");
  }
}

export function validateSecretHash(value: string, name: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 hash.`);
  }
}

export function validatePortalUser(user: PortalUser) {
  validateOwner(user);
  if (!user.relutionUsername?.trim() || user.relutionUsername.length > 256) {
    throw new Error("Portal user Relution username is required.");
  }
}

export function validateClientVersion(value: string) {
  if (!/^[0-9A-Za-z.+-]{1,128}$/.test(value)) {
    throw new Error("clientVersion must be 1 to 128 version characters.");
  }
}
