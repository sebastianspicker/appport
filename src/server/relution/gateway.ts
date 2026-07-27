import type {
  AppAction,
  ApplicationIcon,
  AvailableApp,
  InstalledApplication,
  ManagedDevice,
  NativeDeviceEvidenceV1,
  PortalUser,
} from "@/domain/models";

export interface CurrentDeviceResolution {
  device: ManagedDevice;
  evidenceDigest: string;
  relutionUserUuid: string;
}

export interface RelutionGateway {
  listAssignedWindowsDevices(user: PortalUser): Promise<ManagedDevice[]>;
  resolveCurrentWindowsDevice(
    user: PortalUser,
    evidence: NativeDeviceEvidenceV1,
  ): Promise<CurrentDeviceResolution>;
  listApplications(
    user: PortalUser,
    deviceId: string,
  ): Promise<AvailableApp[]>;
  listInstalledApplications(
    user: PortalUser,
    deviceId: string,
  ): Promise<InstalledApplication[]>;
  requestAction(
    user: PortalUser,
    deviceId: string,
    appId: string,
    idempotencyKey: string,
  ): Promise<{ action: AppAction; created: boolean }>;
  getAction(user: PortalUser, actionId: string): Promise<AppAction>;
  getApplicationIcon(
    user: PortalUser,
    appId: string,
  ): Promise<ApplicationIcon | null>;
  readiness(): Promise<void>;
}
