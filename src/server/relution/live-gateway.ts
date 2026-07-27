import type {
  AppAction,
  ApplicationIcon,
  AppSource,
  AvailableApp,
  InstalledApplication,
  ManagedDevice,
  NativeDeviceEvidenceV1,
  PortalUser,
} from "@/domain/models";
import { matchCurrentDevice } from "@/server/native/device-match";
import {
  ActionReservationConflictError,
  type PersistedAction,
} from "@/server/persistence";
import {
  getActionRepository,
} from "@/server/persistence/runtime";
import {
  getLiveRuntimeConfig,
  type LiveRuntimeConfig,
} from "@/server/runtime-config";
import { RelutionClient } from "./client";
import {
  arrayField,
  booleanField,
  decodeItems,
  decodeWrapper,
  isRecord,
  numberField,
  optionalRecordField,
  recordField,
  stringField,
  type JsonRecord,
} from "./decoders";
import { GatewayError } from "./errors";
import type { RelutionGateway } from "./gateway";

interface RelutionUser {
  uuid: string;
  username: string;
}

interface CatalogApp {
  id: string;
  name: string;
  description: string | null;
  publisher: string | null;
  source: AppSource;
  packageIdentifier: string | null;
  releasedVersionId: string;
  releasedVersionLabel: string | null;
  iconPath: string | null;
}

interface InventoryApp {
  appId: string | null;
  packageId: string;
  name: string;
  versionId: string | null;
  versionLabel: string;
  source: AppSource | null;
  updateAvailable: boolean;
  iconPath: string | null;
}

interface RelutionAction {
  uuid: string;
  state: string;
  type: string;
  creationDate: number;
  errorCode: string | null;
  appUuid: string | null;
  versionUuid: string | null;
  packageIdentifier: string | null;
}

const WINDOWS_SUBTYPES = new Map<string, AppSource>([
  ["WINGET", "winget"],
  ["WINDOWS_MSI", "windows_msi"],
  ["WINDOWS_EXE", "windows_exe"],
]);

const RELUTION_ACTION_TYPES = new Set([
  "DEPLOY_WINGET_APP",
  "DEPLOY_DESKTOP_APP",
  "DEPLOY_CLASSIC_APP",
]);

const CACHE_LIMIT = 256;
const catalogCache = new Map<
  string,
  { expiresAt: number; value: Promise<CatalogApp[]> }
>();

function owner(user: PortalUser) {
  return {
    issuer: user.issuer,
    subject: user.subject,
    relutionUsername: user.relutionUsername,
  };
}

function isActiveState(state: PersistedAction["state"]) {
  return (
    state === "reserved" ||
    state === "queued" ||
    state === "sent" ||
    state === "deferred" ||
    state === "verifying" ||
    state === "unknown"
  );
}

function toPortalAction(action: PersistedAction): AppAction {
  return {
    id: action.id,
    deviceId: action.deviceId,
    appId: action.appId,
    intent: action.intent,
    state: action.state === "reserved" ? "queued" : action.state,
    errorCode: action.errorCode,
    errorMessage: action.errorMessage,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

function epochTimestamp(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

function safeErrorCode(value: JsonRecord) {
  const code = numberField(value, "errorCode");
  return code === null ? null : `RELUTION_${code}`;
}

function sourceFromSubtype(value: unknown): AppSource | null {
  return typeof value === "string" ? WINDOWS_SUBTYPES.get(value) ?? null : null;
}

function sourceFromApplicationSource(value: unknown): AppSource | null {
  if (value === "INSTALLED_BY_WINGET") return "winget";
  if (value === "INSTALLED_BY_COMPANION") return "windows_exe";
  return null;
}

function toManagedDevice(device: ManagedDevice): ManagedDevice {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    status: device.status,
    serialNumber: device.serialNumber,
    lastSeenAt: device.lastSeenAt,
  };
}

export class LiveRelutionGateway implements RelutionGateway {
  private readonly config: LiveRuntimeConfig;
  private readonly client: RelutionClient;
  private readonly repositoryProvider: typeof getActionRepository;

  constructor(
    config = getLiveRuntimeConfig(),
    client?: RelutionClient,
    repositoryProvider: typeof getActionRepository = getActionRepository,
  ) {
    this.config = config;
    this.client = client ?? new RelutionClient(config);
    this.repositoryProvider = repositoryProvider;
  }

  async listAssignedWindowsDevices(user: PortalUser) {
    const relutionUser = await this.resolveUser(user);
    return this.loadDevices(relutionUser.uuid);
  }

  async resolveCurrentWindowsDevice(
    user: PortalUser,
    evidence: NativeDeviceEvidenceV1,
  ) {
    const relutionUser = await this.resolveUser(user);
    const candidates = await this.loadDeviceCandidates(relutionUser.uuid);
    const matched = matchCurrentDevice(evidence, candidates);
    return {
      device: toManagedDevice(matched.device),
      evidenceDigest: matched.evidenceDigest,
      relutionUserUuid: relutionUser.uuid,
    };
  }

  async listApplications(user: PortalUser, deviceId: string) {
    const relutionUser = await this.resolveUser(user);
    await this.assertDevice(relutionUser.uuid, deviceId);
    const [catalog, inventory] = await Promise.all([
      this.permittedCatalog(relutionUser),
      this.loadInventory(deviceId),
    ]);
    const inventoryByApp = new Map(
      inventory
        .filter((item) => item.appId)
        .map((item) => [item.appId!, item]),
    );
    const recent = this.repositoryProvider().listRecentActions(owner(user), 100);

    return catalog.map((app): AvailableApp => {
      const installed = inventoryByApp.get(app.id);
      const active = recent.find(
        (action) =>
          action.deviceId === deviceId &&
          action.appId === app.id &&
          action.targetVersionId === app.releasedVersionId &&
          isActiveState(action.state),
      );
      return {
        id: app.id,
        name: app.name,
        description: app.description,
        publisher: app.publisher,
        source: app.source,
        packageIdentifier: app.packageIdentifier,
        releasedVersionId: app.releasedVersionId,
        releasedVersionLabel: app.releasedVersionLabel,
        installedVersionId: installed?.versionId ?? null,
        installedVersionLabel: installed?.versionLabel ?? null,
        installState: active
          ? "action_active"
          : !installed
            ? "not_installed"
            : installed.updateAvailable
              ? "update_available"
              : "installed",
        activeActionId: active?.id ?? null,
        activeActionState:
          active?.state === "reserved" ? "queued" : active?.state ?? null,
        iconUrl: app.iconPath
          ? `/api/native/apps/${encodeURIComponent(app.id)}/icon`
          : null,
      };
    });
  }

  async listInstalledApplications(
    user: PortalUser,
    deviceId: string,
  ): Promise<InstalledApplication[]> {
    const relutionUser = await this.resolveUser(user);
    await this.assertDevice(relutionUser.uuid, deviceId);
    const [inventory, catalog] = await Promise.all([
      this.loadInventory(deviceId),
      this.permittedCatalog(relutionUser),
    ]);
    const approved = new Map(catalog.map((app) => [app.id, app]));
    return inventory.map((item) => {
      const app = item.appId ? approved.get(item.appId) : undefined;
      return {
        appId: item.appId,
        packageId: item.packageId,
        name: item.name,
        versionId: item.versionId,
        version: item.versionLabel,
        source: item.source ?? app?.source ?? null,
        updateAvailable: Boolean(app && item.updateAvailable),
        approved: Boolean(app),
        iconUrl:
          app?.iconPath && item.appId
            ? `/api/native/apps/${encodeURIComponent(item.appId)}/icon`
            : null,
      };
    });
  }

  async requestAction(
    user: PortalUser,
    deviceId: string,
    appId: string,
    idempotencyKey: string,
  ) {
    if (!this.config.liveWritesEnabled) {
      throw new GatewayError(
        "LIVE_WRITES_DISABLED",
        "Application installation is not enabled for this deployment.",
      );
    }
    const relutionUser = await this.resolveUser(user);
    await this.assertDevice(relutionUser.uuid, deviceId);
    const [catalog, inventory, baseline] = await Promise.all([
      this.loadPermittedCatalog(relutionUser),
      this.loadInventory(deviceId),
      this.loadDeviceActions(deviceId),
    ]);
    const app = catalog.find((candidate) => candidate.id === appId);
    if (!app) {
      throw new GatewayError("FORBIDDEN", "This application is not approved.");
    }
    const inventoryMatches = inventory.filter(
      (item) =>
        item.appId === app.id ||
        (app.packageIdentifier !== null &&
          item.packageId === app.packageIdentifier),
    );
    if (inventoryMatches.length > 1) {
      throw new GatewayError(
        "INVALID_RESPONSE",
        "Installed application identity is ambiguous.",
      );
    }
    const installed = inventoryMatches[0];
    if (installed) {
      if (
        installed.appId !== app.id ||
        !installed.versionId ||
        (app.packageIdentifier !== null &&
          installed.packageId !== app.packageIdentifier)
      ) {
        throw new GatewayError(
          "INVALID_RESPONSE",
          "Installed application identity could not be verified.",
        );
      }
      if (installed.versionId === app.releasedVersionId) {
        throw new GatewayError(
          "CONFLICT",
          "The approved application is already current.",
        );
      }
      if (!installed.updateAvailable) {
        throw new GatewayError(
          "CONFLICT",
          "Relution does not report an approved update for this application.",
        );
      }
    }
    let reservation;
    try {
      reservation = this.repositoryProvider().reserveAction({
        owner: owner(user),
        deviceId,
        appId: app.id,
        targetVersionId: app.releasedVersionId,
        installedVersionId: installed?.versionId ?? null,
        packageIdentifier: app.packageIdentifier,
        intent: installed ? "update" : "install",
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof ActionReservationConflictError) {
        throw new GatewayError(
          "CONFLICT",
          "Another application action is already active for this device.",
        );
      }
      if (error instanceof Error && "code" in error && error.code === "RATE_LIMITED") {
        throw new GatewayError(
          "RATE_LIMITED",
          "Too many application requests. Try again shortly.",
        );
      }
      throw error;
    }
    if (!reservation.created) {
      return {
        action: toPortalAction(reservation.action),
        created: false,
      };
    }

    const repository = this.repositoryProvider();
    const baselineIds = baseline.map((action) => action.uuid).join(",");
    const submittedAt = new Date().toISOString();
    try {
      const response = decodeWrapper(
        await this.client.post(
          `/api/management/v1/content/apps/${encodeURIComponent(app.id)}/versions/${encodeURIComponent(app.releasedVersionId)}/deployments`,
          {
            appUuid: app.id,
            versionUuid: app.releasedVersionId,
            deviceUuid: deviceId,
          },
        ),
      );
      if (response.results.length !== 1) {
        throw new GatewayError(
          "INVALID_RESPONSE",
          "Relution returned an unexpected deployment response.",
        );
      }
      const successful = booleanField(response.results[0], "successful");
      if (successful === null) {
        throw new GatewayError(
          "INVALID_RESPONSE",
          "Relution returned an unexpected deployment response.",
        );
      }
      if (!successful) {
        throw new GatewayError(
          "INVALID_DEPLOYMENT",
          "Relution did not accept the application deployment.",
        );
      }
      const queued = repository.updateAction({
        owner: owner(user),
        id: reservation.action.id,
        state: "queued",
        submittedAt,
        correlationStartedAt: submittedAt,
        event: "deployment_submitted",
        details: { baselineActionUuids: baselineIds },
      });
      if (!queued) throw new Error("Submitted action could not be persisted.");
      return { action: toPortalAction(queued), created: true };
    } catch (error) {
      const definitivelyRejected =
        error instanceof GatewayError &&
        (
          [
            "INTEGRATION_AUTHENTICATION",
            "INTEGRATION_AUTHORIZATION",
            "NOT_FOUND",
            "INVALID_DEPLOYMENT",
          ] as const
        ).includes(
          error.code as
            | "INTEGRATION_AUTHENTICATION"
            | "INTEGRATION_AUTHORIZATION"
            | "NOT_FOUND"
            | "INVALID_DEPLOYMENT",
        );
      repository.updateAction({
        owner: owner(user),
        id: reservation.action.id,
        state: definitivelyRejected ? "failed" : "unknown",
        submittedAt,
        errorCode: definitivelyRejected
          ? "SUBMISSION_REJECTED"
          : "SUBMISSION_UNCERTAIN",
        errorMessage: definitivelyRejected
          ? "Relution rejected the application request."
          : "The submission status could not be confirmed. Do not retry.",
        event: definitivelyRejected
          ? "deployment_rejected"
          : "deployment_uncertain",
      });
      throw error;
    }
  }

  async getAction(user: PortalUser, actionId: string) {
    const repository = this.repositoryProvider();
    let action = repository.getAction(owner(user), actionId);
    if (!action) {
      throw new GatewayError("NOT_FOUND", "Application action was not found.");
    }
    if (action.state === "reserved") {
      action =
        repository.updateAction({
          owner: owner(user),
          id: action.id,
          state: "unknown",
          errorCode: "SUBMISSION_INTERRUPTED",
          errorMessage:
            "The submission status could not be confirmed. Do not retry.",
          event: "reserved_action_recovered",
        }) ?? action;
      return toPortalAction(action);
    }
    if (TERMINAL.has(action.state)) return toPortalAction(action);

    const relutionUser = await this.resolveUser(user);
    await this.assertDevice(relutionUser.uuid, action.deviceId);
    action = await this.refreshAction(user, action);
    return toPortalAction(action);
  }

  async getApplicationIcon(
    user: PortalUser,
    appId: string,
  ): Promise<ApplicationIcon | null> {
    const relutionUser = await this.resolveUser(user);
    const app = (await this.permittedCatalog(relutionUser)).find(
      (candidate) => candidate.id === appId,
    );
    if (!app) {
      throw new GatewayError("NOT_FOUND", "Application icon was not found.");
    }
    if (!app.iconPath) return null;
    const result = await this.client.getBinary(app.iconPath);
    if (!result) return null;
    if (
      result.contentType !== "image/png" &&
      result.contentType !== "image/jpeg" &&
      result.contentType !== "image/webp"
    ) {
      throw new GatewayError(
        "INVALID_RESPONSE",
        "Relution returned an unsupported application icon.",
      );
    }
    return {
      bytes: result.bytes,
      contentType: result.contentType,
    };
  }

  async readiness() {
    this.repositoryProvider().check();
  }

  private async resolveUser(user: PortalUser): Promise<RelutionUser> {
    const query = {
      searches: [user.relutionUsername.trim()],
      getItems: true,
      getNonpagedCount: true,
    };
    const results = await this.postPages(
      "/api/management/v1/security/users/baseInfo/query",
      query,
    );
    const expected = user.relutionUsername.trim().toLowerCase();
    const matches = results.flatMap((item): RelutionUser[] => {
      const username = stringField(item, "name");
      const organization = stringField(item, "organizationUuid");
      if (
        username.trim().toLowerCase() !== expected ||
        organization !== this.config.organizationUuid ||
        booleanField(item, "activated") !== true
      ) {
        return [];
      }
      return [{ uuid: stringField(item, "uuid"), username }];
    });
    if (matches.length !== 1) {
      throw new GatewayError(
        "FORBIDDEN",
        "The portal identity could not be mapped to one active Relution user.",
      );
    }
    return matches[0];
  }

  private async loadDevices(userUuid: string): Promise<ManagedDevice[]> {
    const candidates = await this.loadDeviceCandidates(userUuid);
    return candidates.map(toManagedDevice);
  }

  private async loadDeviceCandidates(userUuid: string) {
    const results = await this.postPages(
      "/api/management/v2/devices/baseInfo/query",
      {
        filter: {
          type: "logOp",
          operation: "AND",
          filters: [
            { type: "string", fieldName: "userUuid", value: userUuid },
            {
              type: "stringEnum",
              fieldName: "platform",
              values: ["WINDOWS"],
            },
          ],
        },
        sortOrder: {
          sortFields: [{ name: "lastConnectionDate", ascending: false }],
        },
        getItems: true,
        getNonpagedCount: true,
      },
    );
    return results.flatMap(
      (item): Array<ManagedDevice & { uuid: string; deviceId: string | null }> => {
      const platform = stringField(item, "platform");
      const status = stringField(item, "status");
      if (
        platform !== "WINDOWS" ||
        (status !== "COMPLIANT" &&
          status !== "NONCOMPLIANT" &&
          status !== "INACTIVE") ||
        stringField(item, "userUuid") !== userUuid ||
        stringField(item, "organizationUuid") !== this.config.organizationUuid
      ) {
        return [];
      }
      return [
        {
          id: stringField(item, "uuid"),
          uuid: stringField(item, "uuid"),
          deviceId: stringField(item, "deviceId", false),
          name: stringField(item, "name"),
          platform: "WINDOWS",
          status,
          serialNumber: stringField(item, "serialNumber", false),
          lastSeenAt: epochTimestamp(numberField(item, "lastConnectionDate")),
        },
      ];
      },
    );
  }

  private async assertDevice(userUuid: string, deviceId: string) {
    const devices = await this.loadDevices(userUuid);
    const device = devices.find((candidate) => candidate.id === deviceId);
    if (!device) {
      throw new GatewayError(
        "FORBIDDEN",
        "The selected device is not assigned to this user.",
      );
    }
    return device;
  }

  private async permittedCatalog(user: RelutionUser) {
    const now = Date.now();
    const existing = catalogCache.get(user.uuid);
    if (existing && existing.expiresAt > now) return existing.value;
    for (const [key, value] of catalogCache) {
      if (value.expiresAt <= now) catalogCache.delete(key);
    }
    if (catalogCache.size >= CACHE_LIMIT) {
      catalogCache.delete(catalogCache.keys().next().value!);
    }
    const value = this.loadPermittedCatalog(user);
    catalogCache.set(user.uuid, {
      expiresAt: now + this.config.cacheTtlMs,
      value,
    });
    value.catch(() => catalogCache.delete(user.uuid));
    return value;
  }

  private async loadPermittedCatalog(user: RelutionUser) {
    const raw = await this.getPages(
      "/api/management/v1/content/apps/baseInfo",
      new URLSearchParams([
        ["getItems", "true"],
        ["getNonpagedCount", "true"],
        ["extend", "versions"],
        ["locale", "en"],
      ]),
    );
    const candidates = raw.flatMap((item): CatalogApp[] => {
      const source = sourceFromSubtype(item.subType);
      if (!source) return [];
      const platforms = item.platforms;
      if (!Array.isArray(platforms) || !platforms.includes("WINDOWS")) return [];
      const versions = recordField(item, "versions");
      const release = optionalRecordField(versions, "RELEASE");
      if (!release) return [];
      const appId = stringField(item, "uuid");
      if (appId === this.config.nativeAppUuid) return [];
      const internalName = stringField(item, "internalName", false);
      const developer = optionalRecordField(item, "developerInformation");
      return [
        {
          id: appId,
          name:
            stringField(item, "name", false) ??
            stringField(item, "defaultName"),
          description: stringField(item, "description", false),
          publisher: developer
            ? stringField(developer, "name", false) ??
              stringField(developer, "companyName", false)
            : null,
          source,
          packageIdentifier: internalName,
          releasedVersionId: stringField(release, "uuid"),
          releasedVersionLabel: stringField(release, "versionName", false),
          iconPath: stringField(item, "icon", false),
        },
      ];
    });

    const directGroups = await this.loadDirectGroups(user.uuid);
    const membershipCache = new Map<string, Promise<boolean>>();
    const permitted: CatalogApp[] = [];
    for (let offset = 0; offset < candidates.length; offset += 8) {
      const batch = candidates.slice(offset, offset + 8);
      const decisions = await Promise.all(
        batch.map((app) =>
          this.canReadApp(app.id, user.uuid, directGroups, membershipCache),
        ),
      );
      for (let index = 0; index < batch.length; index += 1) {
        if (decisions[index]) permitted.push(batch[index]);
      }
    }
    return permitted.sort((left, right) =>
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
    );
  }

  private async loadDirectGroups(userUuid: string) {
    const value = await this.client.get(
      `/api/management/v1/security/users/${encodeURIComponent(userUuid)}/groups`,
    );
    if (!isRecord(value)) {
      throw new GatewayError(
        "INVALID_RESPONSE",
        "Relution returned an unexpected response.",
      );
    }
    return new Set(
      arrayField(value, "groups").map((group) => stringField(group, "uuid")),
    );
  }

  private async canReadApp(
    appId: string,
    userUuid: string,
    directGroups: Set<string>,
    membershipCache: Map<string, Promise<boolean>>,
  ) {
    const wrapper = decodeWrapper(
      await this.client.get(
        `/api/management/v1/content/apps/${encodeURIComponent(appId)}/permissions/RELEASE`,
      ),
    );
    for (const permission of wrapper.results) {
      if (booleanField(permission, "read") !== true) continue;
      const role = recordField(permission, "userGroupInfo");
      const roleUuid = stringField(role, "uuid");
      const roleType = stringField(role, "type");
      if (roleType === "USER" && roleUuid === userUuid) return true;
      if (roleType !== "GROUP") continue;
      if (directGroups.has(roleUuid)) return true;
      let membership = membershipCache.get(roleUuid);
      if (!membership) {
        membership = this.groupContainsUser(roleUuid, userUuid);
        membershipCache.set(roleUuid, membership);
      }
      if (await membership) return true;
    }
    return false;
  }

  private async groupContainsUser(groupUuid: string, userUuid: string) {
    const query = new URLSearchParams([
      ["recursive", "true"],
      ["getItems", "true"],
      ["getNonpagedCount", "true"],
      [
        "filter",
        JSON.stringify({
          type: "string",
          fieldName: "uuid",
          value: userUuid,
        }),
      ],
    ]);
    const path = `/api/management/v1/security/groups/${encodeURIComponent(groupUuid)}/members`;
    const items = await this.getItemPages(path, query);
    return items.some((item) => stringField(item, "uuid") === userUuid);
  }

  private async loadInventory(deviceId: string): Promise<InventoryApp[]> {
    const [v2, v1] = await Promise.all([
      this.postPages(
        `/api/management/v2/devices/${encodeURIComponent(deviceId)}/installedApps/baseInfo/query`,
        { getItems: true, getNonpagedCount: true },
      ),
      this.getPages(
        `/api/management/v1/devices/${encodeURIComponent(deviceId)}/installedApps`,
        new URLSearchParams([
          ["getItems", "true"],
          ["getNonpagedCount", "true"],
          ["locale", "en"],
        ]),
      ),
    ]);
    const statusByApp = new Map(
      v1.flatMap((item): Array<[string, JsonRecord]> => {
        const appId = stringField(item, "appUuid", false);
        return appId ? [[appId, item]] : [];
      }),
    );
    return v2.flatMap((item): InventoryApp[] => {
      const packageId = stringField(item, "identifier", false);
      const name = stringField(item, "name", false);
      if (!packageId || !name) return [];
      const appId = stringField(item, "appUuid", false);
      const status = appId ? statusByApp.get(appId) : undefined;
      return [
        {
          appId,
          packageId,
          name,
          versionId: stringField(item, "versionUuid", false),
          versionLabel:
            stringField(item, "versionToShow", false) ??
            stringField(item, "versionName", false) ??
            "Unknown",
          source:
            sourceFromSubtype(item.appSubType) ??
            sourceFromApplicationSource(item.applicationSource),
          updateAvailable:
            booleanField(item, "hasUpdateAvailable") ??
            (status ? booleanField(status, "hasUpdateAvailable") : null) ??
            false,
          iconPath: stringField(item, "iconUrl", false),
        },
      ];
    });
  }

  private async loadDeviceActions(deviceId: string) {
    const query = new URLSearchParams([
      ["limit", String(this.config.pageSize)],
      ["offset", "0"],
      ["sortOrder", "-creationDate"],
      ["getItems", "true"],
      ["getNonpagedCount", "true"],
      ["getPings", "false"],
    ]);
    const wrapper = decodeWrapper(
      await this.client.get(
        `/api/management/v1/devices/${encodeURIComponent(deviceId)}/actions`,
        query,
      ),
    );
    return wrapper.results.flatMap(decodeAction);
  }

  private async refreshAction(
    user: PortalUser,
    action: PersistedAction,
  ): Promise<PersistedAction> {
    const repository = this.repositoryProvider();
    if (action.state === "unknown") {
      const installed = await this.targetIsInstalled(action);
      if (!installed) return action;
      return (
        repository.updateAction({
          owner: owner(user),
          id: action.id,
          state: "succeeded",
          event: "inventory_reconciled",
        }) ?? action
      );
    }
    if (action.state === "verifying") {
      if (await this.targetIsInstalled(action)) {
        return (
          repository.updateAction({
            owner: owner(user),
            id: action.id,
            state: "succeeded",
            event: "inventory_verified",
          }) ?? action
        );
      }
      if (
        action.verificationDeadlineAt &&
        Date.now() >= Date.parse(action.verificationDeadlineAt)
      ) {
        return (
          repository.updateAction({
            owner: owner(user),
            id: action.id,
            state: "unknown",
            errorCode: "INVENTORY_VERIFICATION_TIMEOUT",
            errorMessage:
              "The installed version could not be confirmed. Do not retry.",
            event: "inventory_verification_timed_out",
          }) ?? action
        );
      }
      return action;
    }

    let relutionAction: RelutionAction | undefined;
    if (action.relutionActionUuid) {
      const wrapper = decodeWrapper(
        await this.client.get(
          `/api/management/v1/devices/${encodeURIComponent(action.deviceId)}/actions/${encodeURIComponent(action.relutionActionUuid)}`,
        ),
      );
      relutionAction = wrapper.results.flatMap(decodeAction)[0];
    } else {
      const actions = await this.loadDeviceActions(action.deviceId);
      const baseline =
        repository
          .listAuditEvents(owner(user), action.id)
          .find((event) => event.event === "deployment_submitted")?.details
          .baselineActionUuids;
      const baselineIds = new Set(
        typeof baseline === "string" && baseline
          ? baseline.split(",").filter(Boolean)
          : [],
      );
      const submitted = action.submittedAt
        ? Date.parse(action.submittedAt) - 5_000
        : Date.parse(action.createdAt) - 5_000;
      const matches = actions.filter(
        (candidate) =>
          !baselineIds.has(candidate.uuid) &&
          candidate.creationDate >= submitted &&
          RELUTION_ACTION_TYPES.has(candidate.type) &&
          (candidate.appUuid === action.appId ||
            candidate.versionUuid === action.targetVersionId ||
            (action.packageIdentifier &&
              candidate.packageIdentifier === action.packageIdentifier)),
      );
      if (matches.length === 1) {
        relutionAction = matches[0];
        action =
          repository.updateAction({
            owner: owner(user),
            id: action.id,
            relutionActionUuid: relutionAction.uuid,
            event: "relution_action_correlated",
          }) ?? action;
      } else {
        const started = action.correlationStartedAt
          ? Date.parse(action.correlationStartedAt)
          : Date.parse(action.createdAt);
        if (Date.now() - started >= this.config.actionCorrelationMs) {
          return (
            repository.updateAction({
              owner: owner(user),
              id: action.id,
              state: "unknown",
              errorCode:
                matches.length > 1
                  ? "AMBIGUOUS_RELUTION_ACTION"
                  : "RELUTION_ACTION_NOT_FOUND",
              errorMessage:
                "The submission status could not be confirmed. Do not retry.",
              event: "action_correlation_failed",
              details: { candidates: matches.length },
            }) ?? action
          );
        }
        return action;
      }
    }

    if (!relutionAction) return action;
    const mapped = mapRelutionState(relutionAction.state);
    if (mapped === "verifying") {
      const verificationDeadline = new Date(
        Date.now() + this.config.actionVerificationMs,
      ).toISOString();
      action =
        repository.updateAction({
          owner: owner(user),
          id: action.id,
          state: "verifying",
          relutionState: relutionAction.state,
          verificationDeadlineAt:
            action.verificationDeadlineAt ?? verificationDeadline,
          event: "relution_executed",
        }) ?? action;
      return this.refreshAction(user, action);
    }
    return (
      repository.updateAction({
        owner: owner(user),
        id: action.id,
        state: mapped,
        relutionState: relutionAction.state,
        errorCode:
          mapped === "failed"
            ? relutionAction.errorCode ?? "RELUTION_ACTION_ERROR"
            : null,
        errorMessage:
          mapped === "failed"
            ? "Relution reported that the installation failed."
            : null,
        event: "relution_state_observed",
      }) ?? action
    );
  }

  private async targetIsInstalled(action: PersistedAction) {
    const inventory = await this.loadInventory(action.deviceId);
    return inventory.some(
      (item) =>
        item.appId === action.appId &&
        item.versionId === action.targetVersionId,
    );
  }

  private async postPages(path: string, base: Record<string, unknown>) {
    const collected: JsonRecord[] = [];
    for (let page = 0; page < this.config.maxPages; page += 1) {
      const wrapper = decodeWrapper(
        await this.client.query(path, {
          ...base,
          limit: this.config.pageSize,
          offset: page * this.config.pageSize,
        }),
      );
      collected.push(...wrapper.results);
      assertPagination(wrapper.total, collected.length);
      if (
        wrapper.results.length < this.config.pageSize ||
        (wrapper.total !== null && collected.length >= wrapper.total)
      ) {
        return collected;
      }
    }
    throw new GatewayError(
      "INVALID_RESPONSE",
      "Relution pagination exceeded the configured limit.",
    );
  }

  private async getPages(path: string, base: URLSearchParams) {
    const collected: JsonRecord[] = [];
    for (let page = 0; page < this.config.maxPages; page += 1) {
      const query = new URLSearchParams(base);
      query.set("limit", String(this.config.pageSize));
      query.set("offset", String(page * this.config.pageSize));
      const wrapper = decodeWrapper(await this.client.get(path, query));
      collected.push(...wrapper.results);
      assertPagination(wrapper.total, collected.length);
      if (
        wrapper.results.length < this.config.pageSize ||
        (wrapper.total !== null && collected.length >= wrapper.total)
      ) {
        return collected;
      }
    }
    throw new GatewayError(
      "INVALID_RESPONSE",
      "Relution pagination exceeded the configured limit.",
    );
  }

  private async getItemPages(path: string, base: URLSearchParams) {
    const collected: JsonRecord[] = [];
    for (let page = 0; page < this.config.maxPages; page += 1) {
      const query = new URLSearchParams(base);
      query.set("limit", String(this.config.pageSize));
      query.set("offset", String(page * this.config.pageSize));
      const wrapper = decodeItems(await this.client.get(path, query));
      collected.push(...wrapper.results);
      assertPagination(wrapper.total, collected.length);
      if (
        wrapper.results.length < this.config.pageSize ||
        (wrapper.total !== null && collected.length >= wrapper.total)
      ) {
        return collected;
      }
    }
    throw new GatewayError(
      "INVALID_RESPONSE",
      "Relution pagination exceeded the configured limit.",
    );
  }
}

const TERMINAL = new Set<PersistedAction["state"]>([
  "succeeded",
  "failed",
  "cancelled",
]);

function decodeAction(value: JsonRecord): RelutionAction[] {
  const type = stringField(value, "type");
  if (!RELUTION_ACTION_TYPES.has(type)) return [];
  const details = optionalRecordField(value, "details");
  return [
    {
      uuid: stringField(value, "uuid"),
      state: stringField(value, "state"),
      type,
      creationDate: numberField(value, "creationDate") ?? 0,
      errorCode: safeErrorCode(value),
      appUuid: details ? stringField(details, "appUuid", false) : null,
      versionUuid: details ? stringField(details, "versionUuid", false) : null,
      packageIdentifier: details
        ? stringField(details, "appInternalName", false)
        : null,
    },
  ];
}

export function mapRelutionState(state: string): AppAction["state"] {
  if (state === "NEW" || state === "PENDING" || state === "PUSH_SENT") {
    return "queued";
  }
  if (
    state === "DELIVERED_CANCELABLE" ||
    state === "DELIVERED" ||
    state === "DELIVERY_CONFIRMED"
  ) {
    return "sent";
  }
  if (state === "NOT_NOW") return "deferred";
  if (state === "EXECUTED") return "verifying";
  if (state === "ERROR") return "failed";
  if (state === "CANCELLED") return "cancelled";
  return "unknown";
}

function assertPagination(total: number | null, collected: number) {
  if (total !== null && total < collected) {
    throw new GatewayError(
      "INVALID_RESPONSE",
      "Relution returned inconsistent pagination metadata.",
    );
  }
}
