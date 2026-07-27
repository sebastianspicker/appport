export type AppSource = "winget" | "windows_msi" | "windows_exe";

export type AppInstallState =
  | "not_installed"
  | "installed"
  | "update_available"
  | "action_active";

export type ActionIntent = "install" | "update";

export type ActionState =
  | "queued"
  | "sent"
  | "deferred"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "DEVICE_MATCH_FAILED"
  | "INTEGRATION_AUTHENTICATION"
  | "INTEGRATION_AUTHORIZATION"
  | "INTEGRATION_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "INVALID_DEPLOYMENT"
  | "LIVE_WRITES_DISABLED"
  | "INTERNAL_ERROR";

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
}

export interface SignOutOutcome {
  remoteRevoked: boolean;
  credentialRemoved: boolean;
  scheduledTaskRemoved: boolean;
}

export interface PortalUser {
  id: string;
  issuer: string;
  subject: string;
  displayName: string;
  relutionUsername: string;
}

export interface ManagedDevice {
  id: string;
  name: string;
  platform: "WINDOWS";
  status: "COMPLIANT" | "NONCOMPLIANT" | "INACTIVE";
  serialNumber: string | null;
  lastSeenAt: string | null;
}

export interface AvailableApp {
  id: string;
  name: string;
  description: string | null;
  publisher: string | null;
  source: AppSource;
  packageIdentifier: string | null;
  releasedVersionId: string;
  releasedVersionLabel: string | null;
  installedVersionId: string | null;
  installedVersionLabel: string | null;
  installState: AppInstallState;
  activeActionId: string | null;
  activeActionState: ActionState | null;
  iconUrl: string | null;
}

export interface InstalledApplication {
  appId: string | null;
  packageId: string;
  name: string;
  versionId: string | null;
  version: string;
  source: AppSource | null;
  updateAvailable: boolean;
  approved: boolean;
  iconUrl: string | null;
}

export interface AppAction {
  id: string;
  deviceId: string;
  appId: string;
  intent: ActionIntent;
  state: ActionState;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationIcon {
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg" | "image/webp";
}

export interface NativeDeviceEvidenceV1 {
  version: 1;
  entDmid?: string;
  smbiosUuid?: string;
  biosSerial?: string;
  hostname: string;
}

export type NativeLocale = "en-US" | "de-DE";

export interface NativeSessionExchangeRequest {
  requestId: string;
  code: string;
  verifier: string;
  clientVersion: string;
  locale: NativeLocale;
  deviceEvidence: NativeDeviceEvidenceV1;
}

export interface NativeSessionExchangeResponse {
  token: string;
  expiresAt: string;
  device: NativeBootstrap["device"];
}

export interface NativeBootstrap {
  user: { displayName: string };
  device: {
    name: string;
    status: ManagedDevice["status"];
    lastSeenAt: string | null;
  };
  sessionExpiresAt: string;
  updateCount: number;
}
