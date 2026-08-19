export type AppSource = "winget" | "windows_msi" | "windows_exe";

export type AppInstallState =
  | "available"
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

export interface ConnectOutcome {
  backgroundCheckRegistered: boolean;
}

export type AuthMethod = "personal_token" | "password";

export type ConnectRequest =
  | {
      authMethod: "personal_token";
      relutionUsername: string;
      accessToken: string;
    }
  | {
      authMethod: "password";
      relutionUsername: string;
      password: string;
    };

export interface AuthCapabilities {
  personalToken: true;
  password: boolean;
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
  updates: { count: number; keys: string[] };
  writesEnabled: boolean;
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
  | "auth-method-unsupported"
  | "device-match-failed"
  | "server"
  | "action"
  | "unknown";

export type NativeErrorCode =
  | "OFFLINE"
  | "SESSION_EXPIRED"
  | "AUTHORIZATION_DENIED"
  | "AUTH_METHOD_UNSUPPORTED"
  | "DEVICE_MATCH_FAILED"
  | "SERVER"
  | "ACTION"
  | "UNKNOWN";

export interface NativeError {
  code: NativeErrorCode;
  message: string;
}
