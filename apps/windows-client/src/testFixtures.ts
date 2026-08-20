import { vi } from "vitest";
import type { Mocked } from "vitest";
import type {
  AppAction,
  AvailableApp,
  AuthCapabilities,
  NativeBootstrap,
  SignOutOutcome,
} from "./models";
import type { native as nativeApi } from "./native";

export function availableApp(
  id: string,
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

export function appAction(
  state: AppAction["state"],
  overrides: Partial<AppAction> = {},
): AppAction {
  return {
    id: "action-42",
    appId: "firefox",
    deviceId: "device",
    intent: "install",
    state,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
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

export function nativeBootstrap(
  overrides: Partial<NativeBootstrap> = {},
): NativeBootstrap {
  return {
    user: { displayName: "Ada" },
    device: { name: "PC", status: "COMPLIANT", lastSeenAt: null },
    availableCount: 0,
    updates: { count: 0, keys: [] },
    writesEnabled: false,
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

export function authCapabilities(
  overrides: Partial<AuthCapabilities> = {},
): AuthCapabilities {
  return { personalToken: true, password: false, ...overrides };
}

export type NativeMock = Mocked<typeof nativeApi>;

export function createNativeMock(): NativeMock {
  return {
    initialView: vi
      .fn<typeof nativeApi.initialView>()
      .mockResolvedValue("apps"),
    connect: vi.fn<typeof nativeApi.connect>(),
    authCapabilities: vi
      .fn<typeof nativeApi.authCapabilities>()
      .mockResolvedValue(authCapabilities()),
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
    openRelutionPortal: vi
      .fn<typeof nativeApi.openRelutionPortal>()
      .mockResolvedValue(undefined),
  };
}

export function resetNativeMockDefaults(mock: NativeMock) {
  mock.initialView.mockReset().mockResolvedValue("apps");
  mock.connect.mockReset();
  mock.authCapabilities.mockReset().mockResolvedValue(authCapabilities());
  mock.bootstrap.mockReset().mockResolvedValue(nativeBootstrap());
  mock.apps.mockReset().mockResolvedValue([]);
  mock.act.mockReset();
  mock.action.mockReset();
  mock.icon.mockReset().mockResolvedValue(null);
  mock.signOut.mockReset().mockResolvedValue(signOutOutcome());
  mock.openRelutionPortal.mockReset().mockResolvedValue(undefined);
}
