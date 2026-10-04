import { type Mocked, vi } from "vitest";
import type {
  AvailableApp,
  CatalogSnapshot,
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

export function catalogSnapshot(
  apps: AvailableApp[] = [],
  bootstrap = nativeBootstrap(),
  catalogRevision = "revision-1",
): CatalogSnapshot {
  return { apps, bootstrap, catalogRevision };
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export type NativeMock = Mocked<typeof nativeApi>;

export function createNativeMock(): NativeMock {
  return {
    initialView: vi
      .fn<typeof nativeApi.initialView>()
      .mockResolvedValue("apps"),
    connect: vi.fn<typeof nativeApi.connect>(),
    loadCatalog: vi
      .fn<typeof nativeApi.loadCatalog>()
      .mockResolvedValue(catalogSnapshot()),
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
  mock.loadCatalog.mockReset().mockResolvedValue(catalogSnapshot());
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
