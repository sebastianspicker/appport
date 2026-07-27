export type {
  ActionState,
  AppAction,
  AppInstallState,
  AppSource,
  AvailableApp,
  InstalledApplication,
  NativeBootstrap,
  NativeDeviceEvidenceV1,
} from "@relution/appport-contracts";

export type ClientProblem =
  | "loading"
  | "empty"
  | "offline"
  | "session-expired"
  | "device-match-failed"
  | "server"
  | "action"
  | "unknown";

export type NativeErrorCode =
  | "OFFLINE"
  | "SESSION_EXPIRED"
  | "DEVICE_MATCH_FAILED"
  | "SERVER"
  | "ACTION"
  | "UNKNOWN";

export interface NativeError {
  code: NativeErrorCode;
  message: string;
}

export interface SignOutOutcome {
  remoteRevocation: "revoked" | "not_attempted" | "failed";
  credentialDeletion: "deleted" | "failed";
  scheduledTaskRemoval: "removed" | "failed";
}
