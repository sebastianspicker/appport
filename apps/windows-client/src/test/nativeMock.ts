import { type Mocked, vi } from "vitest";
import type {
  AppAction,
  AvailableApp,
  NativeBootstrap,
  SignOutOutcome,
  SupportBundleResult,
  SupportDetails,
} from "../native-bridge/types";
import type { native as nativeApi } from "../native-bridge/native";

export function availableApp(
  id = "firefox",
  name = id,
  overrides: Partial<AvailableApp> = {},
): AvailableApp {
  return {
    id,
    name,
    description: null,
    publisher: null,
    source: "winget",
    packageIdentifier: null,
    releasedVersionId: "release",
    releasedVersionLabel: "128",
    installedVersionId: null,
    installedVersionLabel: null,
    installState: "available",
    activeActionId: null,
    activeActionState: null,
    hasIcon: false,
    ...overrides,
  };
}

export function nativeBootstrap(
  overrides: Partial<NativeBootstrap> = {},
): NativeBootstrap {
  return {
    user: { displayName: "Ada" },
    device: { name: "PC", status: "COMPLIANT", lastSeenAt: null },
    assignedEligibleCount: 1,
    availableCount: 0,
    updates: { count: 0, keys: [] },
    writesEnabled: false,
    ...overrides,
  };
}

export function supportDetails(
  overrides: Partial<SupportDetails> = {},
): SupportDetails {
  return {
    appVersion: "0.1.0",
    sourceRevision: "abc123",
    username: "Ada",
    deviceName: "PC",
    deviceStatus: "COMPLIANT",
    windowsDisplay: "Windows 11",
    manufacturer: "Contoso",
    model: "Model",
    smbiosSerial: "serial",
    matchedRelutionLastIp: "127.0.0.1",
    matchedRelutionLastConnectionAt: null,
    assignedEligibleCount: 1,
    availableCount: 1,
    updateCount: 0,
    ...overrides,
  };
}

export function signOutOutcome(
  overrides: Partial<SignOutOutcome> = {},
): SignOutOutcome {
  return {
    tokenRevocationRequired: false,
    credentialRemoved: true,
    scheduledTaskRemoved: true,
    notificationStateCleared: true,
    ...overrides,
  };
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

export type NativeMock = Mocked<typeof nativeApi>;

export function createNativeMock(): NativeMock {
  return {
    initialView: vi
      .fn<typeof nativeApi.initialView>()
      .mockResolvedValue("apps"),
    connect: vi.fn<typeof nativeApi.connect>(),
    bootstrap: vi
      .fn<typeof nativeApi.bootstrap>()
      .mockResolvedValue(nativeBootstrap()),
    apps: vi.fn<typeof nativeApi.apps>().mockResolvedValue([]),
    act: vi.fn<typeof nativeApi.act>(),
    action: vi.fn<typeof nativeApi.action>(),
    icon: vi.fn<typeof nativeApi.icon>().mockResolvedValue(null),
    signOut: vi
      .fn<typeof nativeApi.signOut>()
      .mockResolvedValue(signOutOutcome()),
    supportDetails: vi
      .fn<typeof nativeApi.supportDetails>()
      .mockResolvedValue(supportDetails()),
    generateSupportBundle: vi
      .fn<typeof nativeApi.generateSupportBundle>()
      .mockResolvedValue({
        bundleFileName: "bundle.zip",
        bytes: 1024,
        warnings: [],
      } satisfies SupportBundleResult),
    openSupportFolder: vi
      .fn<typeof nativeApi.openSupportFolder>()
      .mockResolvedValue(undefined),
    openRelutionPortal: vi
      .fn<typeof nativeApi.openRelutionPortal>()
      .mockResolvedValue(undefined),
  };
}

export function resetNativeMockDefaults(mock: NativeMock) {
  mock.initialView.mockReset().mockResolvedValue("apps");
  mock.connect.mockReset();
  mock.bootstrap.mockReset().mockResolvedValue(nativeBootstrap());
  mock.apps.mockReset().mockResolvedValue([]);
  mock.act.mockReset();
  mock.action.mockReset();
  mock.icon.mockReset().mockResolvedValue(null);
  mock.signOut.mockReset().mockResolvedValue(signOutOutcome());
  mock.supportDetails.mockReset().mockResolvedValue(supportDetails());
  mock.generateSupportBundle.mockReset().mockResolvedValue({
    bundleFileName: "bundle.zip",
    bytes: 1024,
    warnings: [],
  });
  mock.openSupportFolder.mockReset().mockResolvedValue(undefined);
  mock.openRelutionPortal.mockReset().mockResolvedValue(undefined);
}
