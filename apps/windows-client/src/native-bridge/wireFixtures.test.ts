import { describe, expect, it } from "vitest";
import nativeContract from "../../native-contract.json";
import fixtures from "../../wire-fixtures.json";
import type { native } from "./native";
import type {
  ActionIntent,
  ActionState,
  AppAction,
  AppInstallState,
  AppSource,
  AvailableApp,
  CatalogSnapshot,
  ConnectOutcome,
  ConnectRequest,
  NativeBootstrap,
  NativeError,
  SignOutOutcome,
  SupportBundleResult,
  SupportDetails,
} from "./types";

type LoadCatalogRequest = Parameters<typeof native.loadCatalog>[0];

// Compile-time exhaustive key maps: adding or removing a field in types.ts
// fails `tsc` here until the golden fixture and these maps are updated.
const appKeys: Record<keyof AvailableApp, true> = {
  id: true,
  name: true,
  description: true,
  publisher: true,
  source: true,
  packageIdentifier: true,
  releasedVersionId: true,
  releasedVersionLabel: true,
  installedVersionId: true,
  installedVersionLabel: true,
  installState: true,
  activeActionId: true,
  activeActionState: true,
  hasIcon: true,
};
const actionKeys: Record<keyof AppAction, true> = {
  id: true,
  deviceId: true,
  appId: true,
  intent: true,
  state: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
};
const bootstrapKeys: Record<keyof NativeBootstrap, true> = {
  user: true,
  device: true,
  assignedEligibleCount: true,
  availableCount: true,
  updates: true,
  writesEnabled: true,
};
const snapshotKeys: Record<keyof CatalogSnapshot, true> = {
  bootstrap: true,
  apps: true,
  catalogRevision: true,
};
const supportKeys: Record<keyof SupportDetails, true> = {
  appVersion: true,
  sourceRevision: true,
  username: true,
  deviceName: true,
  deviceStatus: true,
  windowsDisplay: true,
  manufacturer: true,
  model: true,
  smbiosSerial: true,
  matchedRelutionLastIp: true,
  matchedRelutionLastConnectionAt: true,
  assignedEligibleCount: true,
  availableCount: true,
  updateCount: true,
};
const bundleKeys: Record<keyof SupportBundleResult, true> = {
  bundleFileName: true,
  bytes: true,
  warnings: true,
};
const signOutKeys: Record<keyof SignOutOutcome, true> = {
  tokenRevocationRequired: true,
  credentialRemoved: true,
  scheduledTaskRemoved: true,
  notificationStateCleared: true,
};
const connectOutcomeKeys: Record<keyof ConnectOutcome, true> = {
  backgroundCheckRegistered: true,
};
const connectRequestKeys: Record<keyof ConnectRequest, true> = {
  authMethod: true,
  relutionUsername: true,
  accessToken: true,
};
const loadCatalogKeys: Record<keyof LoadCatalogRequest, true> = {
  view: true,
  forceRefresh: true,
};
const errorKeys: Record<keyof NativeError, true> = {
  code: true,
  message: true,
};
const userKeys: Record<keyof NativeBootstrap["user"], true> = {
  displayName: true,
};
const deviceKeys: Record<keyof NativeBootstrap["device"], true> = {
  name: true,
  status: true,
  lastSeenAt: true,
};
const updatesKeys: Record<keyof NativeBootstrap["updates"], true> = {
  count: true,
  keys: true,
};

// Typed fixtures: a missing or mistyped field fails `pnpm frontend:check`.
const app = fixtures.AvailableApp as AvailableApp;
const appVariants = fixtures.AvailableAppVariants as AvailableApp[];
const action = fixtures.AppAction as AppAction;
const actionVariants = fixtures.AppActionVariants as AppAction[];
const bootstrap = fixtures.NativeBootstrap as NativeBootstrap;
const snapshot = fixtures.CatalogSnapshot as CatalogSnapshot;
const details = fixtures.SupportDetails as SupportDetails;
const minimalDetails = fixtures.SupportDetailsMinimal as SupportDetails;
const bundle = fixtures.SupportBundleResult as SupportBundleResult;
const signOut = fixtures.SignOutOutcome as SignOutOutcome;
const connectStarted = fixtures.ConnectStarted as ConnectOutcome;
const connectRequest = fixtures.ConnectRequest as ConnectRequest;
const loadCatalog = fixtures.LoadCatalogRequest as LoadCatalogRequest;
const errors = fixtures.NativeErrors as NativeError[];

const keysOf = (value: object) => Object.keys(value).sort();
const sortedUnique = (values: readonly (string | null)[]) =>
  [...new Set(values)].filter((value) => value !== null).sort();

describe("wire fixtures match the TypeScript contract", () => {
  it("uses exactly the declared fields for every payload", () => {
    const cases: ReadonlyArray<readonly [object, object]> = [
      [app, appKeys],
      ...appVariants.map((item) => [item, appKeys] as const),
      [action, actionKeys],
      ...actionVariants.map((item) => [item, actionKeys] as const),
      [bootstrap, bootstrapKeys],
      [bootstrap.user, userKeys],
      [bootstrap.device, deviceKeys],
      [bootstrap.updates, updatesKeys],
      [snapshot, snapshotKeys],
      [snapshot.bootstrap, bootstrapKeys],
      [snapshot.apps[0], appKeys],
      [details, supportKeys],
      [minimalDetails, supportKeys],
      [bundle, bundleKeys],
      [signOut, signOutKeys],
      [connectStarted, connectOutcomeKeys],
      [connectRequest, connectRequestKeys],
      [loadCatalog, loadCatalogKeys],
      ...errors.map((item) => [item, errorKeys] as const),
    ];
    for (const [payload, expected] of cases) {
      expect(keysOf(payload)).toEqual(keysOf(expected));
    }
  });

  it("covers every enum value used by the TypeScript unions", () => {
    const sources: AppSource[] = ["winget", "windows_msi", "windows_exe"];
    const installStates: AppInstallState[] = ["available", "update_available"];
    const intents: ActionIntent[] = ["install", "update"];
    const states: ActionState[] = [
      "queued",
      "sent",
      "deferred",
      "verifying",
      "succeeded",
      "failed",
      "cancelled",
      "unknown",
    ];
    expect(sortedUnique(appVariants.map((item) => item.source))).toEqual(
      [...sources].sort(),
    );
    expect(sortedUnique(appVariants.map((item) => item.installState))).toEqual(
      [...installStates].sort(),
    );
    expect(
      sortedUnique(appVariants.map((item) => item.activeActionState)),
    ).toEqual([...states].sort());
    expect(sortedUnique(actionVariants.map((item) => item.state))).toEqual(
      [...states].sort(),
    );
    expect(sortedUnique(actionVariants.map((item) => item.intent))).toEqual(
      [...intents].sort(),
    );
    expect(appVariants.some((item) => item.activeActionState === null)).toBe(
      true,
    );
  });

  it("matches the shared native contract lists", () => {
    expect(sortedUnique(appVariants.map((item) => item.installState))).toEqual(
      [...nativeContract.installStates].sort(),
    );
    expect(sortedUnique(errors.map((item) => item.code))).toEqual(
      [...nativeContract.nativeErrorCodes].sort(),
    );
    expect(fixtures.CatalogViews).toEqual(["apps", "updates"]);
    expect(loadCatalog.view).toBe("updates");
    expect(connectRequest.authMethod).toBe("personal_token");
  });
});
