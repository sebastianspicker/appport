import type { ActionIntent, ActionState, PortalUser } from "@/domain/models";

export type StoredActionState = "reserved" | ActionState;

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

export interface ActionRow {
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

export interface AuditRow {
  id: number;
  action_id: string;
  event_type: string;
  outcome: StoredActionState;
  details_json: string;
  created_at: number;
}

export interface NativeAuthRequestRow {
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

export interface NativeSessionRow {
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

