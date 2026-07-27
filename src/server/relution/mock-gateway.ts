import { randomUUID } from "node:crypto";
import type {
  AppAction,
  AppSource,
  AvailableApp,
  InstalledApplication,
  ManagedDevice,
  NativeDeviceEvidenceV1,
  PortalUser,
} from "@/domain/models";
import { matchCurrentDevice } from "@/server/native/device-match";
import { GatewayError } from "./errors";
import type { RelutionGateway } from "./gateway";
import { MemoryRateLimiter } from "./rate-limit";

interface FixtureApp {
  id: string;
  name: string;
  description: string;
  publisher: string;
  source: AppSource;
  packageIdentifier: string;
  releasedVersionId: string;
  releasedVersionLabel: string;
  installed: Record<
    string,
    { versionId: string; versionLabel: string; updateAvailable: boolean }
  >;
  failsFirstAttempt?: boolean;
}

interface StoredAction extends AppAction {
  ownerId: string;
  idempotencyKey: string;
  targetVersionId: string;
  fail: boolean;
}

const MOCK_RELUTION_USERNAME = "alex.morgan";

const devices: ManagedDevice[] = [
  {
    id: "device-office-laptop",
    name: "Office Laptop",
    platform: "WINDOWS",
    status: "COMPLIANT",
    serialNumber: "OFFICE-001",
    lastSeenAt: "2026-07-23T08:42:00.000Z",
  },
  {
    id: "device-travel-laptop",
    name: "Travel Laptop",
    platform: "WINDOWS",
    status: "INACTIVE",
    serialNumber: "TRAVEL-002",
    lastSeenAt: "2026-07-20T14:10:00.000Z",
  },
];

const apps: FixtureApp[] = [
  {
    id: "7zip",
    name: "7-Zip",
    description: "File archiver for Windows.",
    publisher: "Igor Pavlov",
    source: "winget",
    packageIdentifier: "7zip.7zip",
    releasedVersionId: "7zip-24.09",
    releasedVersionLabel: "24.09",
    installed: {
      "device-office-laptop": {
        versionId: "7zip-23.01",
        versionLabel: "23.01",
        updateAvailable: true,
      },
    },
  },
  {
    id: "firefox",
    name: "Mozilla Firefox",
    description: "Managed web browser.",
    publisher: "Mozilla",
    source: "winget",
    packageIdentifier: "Mozilla.Firefox",
    releasedVersionId: "firefox-128.0.4",
    releasedVersionLabel: "128.0.4",
    installed: {
      "device-office-laptop": {
        versionId: "firefox-128.0.3",
        versionLabel: "128.0.3",
        updateAvailable: true,
      },
    },
  },
  {
    id: "vlc",
    name: "VLC media player",
    description: "Audio and video player.",
    publisher: "VideoLAN",
    source: "winget",
    packageIdentifier: "VideoLAN.VLC",
    releasedVersionId: "vlc-3.0.21",
    releasedVersionLabel: "3.0.21",
    installed: {
      "device-office-laptop": {
        versionId: "vlc-3.0.20",
        versionLabel: "3.0.20",
        updateAvailable: true,
      },
    },
    failsFirstAttempt: true,
  },
  {
    id: "notepad-plus-plus",
    name: "Notepad++",
    description: "Text and source-code editor.",
    publisher: "Notepad++ Team",
    source: "winget",
    packageIdentifier: "Notepad++.Notepad++",
    releasedVersionId: "npp-8.7.4",
    releasedVersionLabel: "8.7.4",
    installed: {
      "device-office-laptop": {
        versionId: "npp-8.7.4",
        versionLabel: "8.7.4",
        updateAvailable: false,
      },
      "device-travel-laptop": {
        versionId: "npp-8.7.4",
        versionLabel: "8.7.4",
        updateAvailable: false,
      },
    },
  },
  {
    id: "powertoys",
    name: "Microsoft PowerToys",
    description: "Windows utilities approved by IT.",
    publisher: "Microsoft",
    source: "winget",
    packageIdentifier: "Microsoft.PowerToys",
    releasedVersionId: "powertoys-0.93.0",
    releasedVersionLabel: "0.93.0",
    installed: {},
  },
];

const actions = new Map<string, StoredAction>();
const attempts = new Map<string, number>();
const limiter = new MemoryRateLimiter(8, 60_000);

function assertUser(user: PortalUser) {
  if (
    user.relutionUsername.trim().toLowerCase() !== MOCK_RELUTION_USERNAME
  ) {
    throw new GatewayError("FORBIDDEN", "This user has no assigned devices.");
  }
}

function ownerId(user: PortalUser) {
  return `${user.issuer}:${user.subject}`;
}

function assertDevice(user: PortalUser, deviceId: string) {
  assertUser(user);
  if (!devices.some((device) => device.id === deviceId)) {
    throw new GatewayError(
      "FORBIDDEN",
      "The selected device is not assigned to this user.",
    );
  }
}

function materializeAction(action: StoredAction, now = Date.now()): AppAction {
  const elapsed = now - Date.parse(action.createdAt);
  let state: AppAction["state"];
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  if (elapsed < 800) {
    state = "queued";
  } else if (elapsed < 1_800) {
    state = "sent";
  } else if (action.fail && elapsed >= 2_500) {
    state = "failed";
    errorCode = "INSTALLER_EXIT_CODE";
    errorMessage = "The installer could not complete. Try again.";
  } else if (elapsed < 3_500) {
    state = "verifying";
  } else {
    state = "succeeded";
  }

  return {
    id: action.id,
    deviceId: action.deviceId,
    appId: action.appId,
    intent: action.intent,
    state,
    errorCode,
    errorMessage,
    createdAt: action.createdAt,
    updatedAt: new Date(now).toISOString(),
  };
}

function latestAction(deviceId: string, appId: string) {
  return [...actions.values()]
    .filter((action) => action.deviceId === deviceId && action.appId === appId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function isActive(state: AppAction["state"]) {
  return (
    state === "queued" ||
    state === "sent" ||
    state === "deferred" ||
    state === "verifying" ||
    state === "unknown"
  );
}

function activeAction(deviceId: string, appId: string) {
  const latest = latestAction(deviceId, appId);
  return latest && isActive(materializeAction(latest).state) ? latest : undefined;
}

function effectiveInstallation(fixture: FixtureApp, deviceId: string) {
  const latest = latestAction(deviceId, fixture.id);
  if (latest && materializeAction(latest).state === "succeeded") {
    return {
      versionId: fixture.releasedVersionId,
      versionLabel: fixture.releasedVersionLabel,
      updateAvailable: false,
    };
  }
  return fixture.installed[deviceId];
}

export class MockRelutionGateway implements RelutionGateway {
  async listAssignedWindowsDevices(user: PortalUser) {
    assertUser(user);
    return structuredClone(devices);
  }

  async resolveCurrentWindowsDevice(
    user: PortalUser,
    evidence: NativeDeviceEvidenceV1,
  ) {
    assertUser(user);
    const matched = matchCurrentDevice(
      evidence,
      devices.map((device) => ({
        ...device,
        uuid: device.id,
        deviceId:
          device.id === "device-office-laptop"
            ? "6b29fc40-ca47-1067-b31d-00dd010662da"
            : "travel-ent-dmid",
      })),
    );
    return {
      device: structuredClone(
        devices.find((device) => device.id === matched.device.uuid)!,
      ),
      evidenceDigest: matched.evidenceDigest,
      relutionUserUuid: "mock-relution-user",
    };
  }

  async listApplications(
    user: PortalUser,
    deviceId: string,
  ): Promise<AvailableApp[]> {
    assertDevice(user, deviceId);
    return apps.map((fixture) => {
      const installation = effectiveInstallation(fixture, deviceId);
      const latest = latestAction(deviceId, fixture.id);
      const action = latest ? materializeAction(latest) : null;
      const active = action && isActive(action.state) ? action : null;
      const installState = active
        ? "action_active"
        : !installation
          ? "not_installed"
          : installation.updateAvailable
            ? "update_available"
            : "installed";
      return {
        id: fixture.id,
        name: fixture.name,
        description: fixture.description,
        publisher: fixture.publisher,
        source: fixture.source,
        packageIdentifier: fixture.packageIdentifier,
        releasedVersionId: fixture.releasedVersionId,
        releasedVersionLabel: fixture.releasedVersionLabel,
        installedVersionId: installation?.versionId ?? null,
        installedVersionLabel: installation?.versionLabel ?? null,
        installState,
        activeActionId: active?.id ?? null,
        activeActionState: active?.state ?? null,
        iconUrl: null,
      };
    });
  }

  async listInstalledApplications(
    user: PortalUser,
    deviceId: string,
  ): Promise<InstalledApplication[]> {
    assertDevice(user, deviceId);
    return apps.flatMap((fixture) => {
      const installation = effectiveInstallation(fixture, deviceId);
      if (!installation) return [];
      return [
        {
          appId: fixture.id,
          packageId: fixture.packageIdentifier,
          name: fixture.name,
          versionId: installation.versionId,
          version: installation.versionLabel,
          source: fixture.source,
          updateAvailable: installation.updateAvailable,
          approved: true,
          iconUrl: null,
        },
      ];
    });
  }

  async requestAction(
    user: PortalUser,
    deviceId: string,
    appId: string,
    idempotencyKey: string,
  ) {
    assertDevice(user, deviceId);
    limiter.assertAllowed(`${user.issuer}:${user.subject}`);

    const fixture = apps.find((app) => app.id === appId);
    if (!fixture) {
      throw new GatewayError("NOT_FOUND", "This application is not approved.");
    }

    const duplicate = [...actions.values()].find(
      (action) =>
        action.ownerId === ownerId(user) &&
        action.deviceId === deviceId &&
        action.appId === appId &&
        action.idempotencyKey === idempotencyKey,
    );
    if (duplicate) {
      return { action: materializeAction(duplicate), created: false };
    }

    const current = activeAction(deviceId, appId);
    if (current) {
      return { action: materializeAction(current), created: false };
    }

    const installation = effectiveInstallation(fixture, deviceId);
    if (installation && !installation.updateAvailable) {
      throw new GatewayError(
        "CONFLICT",
        "The approved application is already current.",
      );
    }

    const attemptKey = `${deviceId}:${appId}`;
    const attempt = (attempts.get(attemptKey) ?? 0) + 1;
    attempts.set(attemptKey, attempt);
    const now = new Date().toISOString();
    const stored: StoredAction = {
      id: randomUUID(),
      ownerId: ownerId(user),
      deviceId,
      appId,
      idempotencyKey,
      targetVersionId: fixture.releasedVersionId,
      intent: installation ? "update" : "install",
      state: "queued",
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      fail: fixture.failsFirstAttempt === true && attempt === 1,
    };
    actions.set(stored.id, stored);
    return { action: materializeAction(stored), created: true };
  }

  async getAction(user: PortalUser, actionId: string) {
    assertUser(user);
    const action = actions.get(actionId);
    if (!action) {
      throw new GatewayError("NOT_FOUND", "Application action was not found.");
    }
    if (action.ownerId !== ownerId(user)) {
      throw new GatewayError(
        "FORBIDDEN",
        "Application action is not owned by this user.",
      );
    }
    return materializeAction(action);
  }

  async getApplicationIcon() {
    return null;
  }

  async readiness() {}
}

export const mockRelutionGateway = new MockRelutionGateway();

export function resetMockGateway() {
  actions.clear();
  attempts.clear();
  limiter.reset();
}
