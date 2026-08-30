export type AppSource = "winget" | "windows_msi" | "windows_exe";

export type AppInstallState = "available" | "update_available";

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

export interface ConnectOutcome {
  backgroundCheckRegistered: boolean;
}

export interface ConnectRequest {
  authMethod: "personal_token";
  relutionUsername: string;
  accessToken: string;
}

export interface SignOutOutcome {
  tokenRevocationRequired: boolean;
  credentialRemoved: boolean;
  scheduledTaskRemoved: boolean;
  notificationStateCleared: boolean;
}

export interface NativeBootstrap {
  user: { displayName: string };
  device: { name: string; status: string; lastSeenAt: string | null };
  assignedEligibleCount: number;
  availableCount: number;
  updates: { count: number; keys: string[] };
  writesEnabled: boolean;
}

export interface SupportDetails {
  appVersion: string;
  sourceRevision: string;
  username: string;
  deviceName: string;
  deviceStatus: string;
  windowsDisplay: string;
  manufacturer: string | null;
  model: string | null;
  smbiosSerial: string | null;
  matchedRelutionLastIp: string | null;
  matchedRelutionLastConnectionAt: string | null;
  assignedEligibleCount: number;
  availableCount: number;
  updateCount: number;
}

export interface SupportBundleResult {
  bundleFileName: string;
  bytes: number;
  warnings: string[];
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
  hasIcon: boolean;
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

export type ClientProblem =
  | "loading"
  | "empty"
  | "offline"
  | "session-expired"
  | "authorization-denied"
  | "device-match-failed"
  | "server"
  | "unknown";

export type NativeErrorCode =
  | "OFFLINE"
  | "SESSION_EXPIRED"
  | "AUTHORIZATION_DENIED"
  | "DEVICE_MATCH_FAILED"
  | "SERVER"
  | "SUPPORT"
  | "UNKNOWN";

export interface NativeError {
  code: NativeErrorCode;
  message: string;
}
