import type {
  AppAction,
  ApplicationIcon,
  InstalledApplication,
  NativeDeviceEvidenceV1,
  PortalUser,
} from "@/domain/models";
import {
  ActionReservationConflictError,
  type PersistedAction,
  type ReservationResult,
} from "@/server/persistence";
import {
  getActionRepository,
} from "@/server/persistence/runtime";
import {
  getLiveRuntimeConfig,
  type LiveRuntimeConfig,
} from "@/server/runtime-config";
import { RelutionClient } from "./client";
import { booleanField, decodeWrapper } from "./decoders";
import { GatewayError } from "./errors";
import type { RelutionGateway } from "./gateway";
import {
  activeActionFor,
  availableAppFor,
  installedAppFor,
} from "./application-mappers";
import { LiveGatewayActions } from "./live-gateway-actions";
import { LiveGatewayData } from "./live-gateway-data";
export { mapRelutionState } from "./live-gateway-actions";

function owner(user: PortalUser) {
  return {
    issuer: user.issuer,
    subject: user.subject,
    relutionUsername: user.relutionUsername,
  };
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

export class LiveRelutionGateway implements RelutionGateway {
  private readonly config: LiveRuntimeConfig;
  private readonly client: RelutionClient;
  private readonly repositoryProvider: typeof getActionRepository;
  private readonly data: LiveGatewayData;
  private readonly actions: LiveGatewayActions;

  constructor(
    config = getLiveRuntimeConfig(),
    client?: RelutionClient,
    repositoryProvider: typeof getActionRepository = getActionRepository,
  ) {
    this.config = config;
    this.client = client ?? new RelutionClient(config);
    this.repositoryProvider = repositoryProvider;
    this.data = new LiveGatewayData(config, this.client);
    this.actions = new LiveGatewayActions({
      config,
      client: this.client,
      repositoryProvider,
      owner,
      loadDeviceActions: (deviceId) => this.loadDeviceActions(deviceId),
      targetIsInstalled: (action) => this.targetIsInstalled(action),
    });
  }

  async listAssignedWindowsDevices(user: PortalUser) {
    const relutionUser = await this.data.resolveUser(user);
    return this.data.loadDevices(relutionUser.uuid);
  }

  async resolveCurrentWindowsDevice(
    user: PortalUser,
    evidence: NativeDeviceEvidenceV1,
  ) {
    return this.data.resolveCurrentWindowsDevice(user, evidence);
  }

  async listApplications(user: PortalUser, deviceId: string) {
    const relutionUser = await this.data.resolveUser(user);
    await this.data.assertDevice(relutionUser.uuid, deviceId);
    const [catalog, inventory] = await Promise.all([
      this.data.permittedCatalog(relutionUser),
      this.data.loadInventory(deviceId),
    ]);
    const inventoryByApp = new Map(
      inventory
        .flatMap((item) => (item.appId ? [[item.appId, item] as const] : [])),
    );
    const recent = this.repositoryProvider().listRecentActions(owner(user), 100);

    return catalog.map((app) =>
      availableAppFor(
        app,
        inventoryByApp.get(app.id),
        activeActionFor(recent, deviceId, app),
      ),
    );
  }

  async listInstalledApplications(
    user: PortalUser,
    deviceId: string,
  ): Promise<InstalledApplication[]> {
    const relutionUser = await this.data.resolveUser(user);
    await this.data.assertDevice(relutionUser.uuid, deviceId);
    const [inventory, catalog] = await Promise.all([
      this.data.loadInventory(deviceId),
      this.data.permittedCatalog(relutionUser),
    ]);
    const approved = new Map(catalog.map((app) => [app.id, app]));
    return inventory.map((item) =>
      installedAppFor(item, item.appId ? approved.get(item.appId) : undefined),
    );
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
    const relutionUser = await this.data.resolveUser(user);
    await this.data.assertDevice(relutionUser.uuid, deviceId);
    const [catalog, inventory, baseline] = await Promise.all([
      this.data.loadPermittedCatalog(relutionUser),
      this.data.loadInventory(deviceId),
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
    let reservation: ReservationResult;
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

    const relutionUser = await this.data.resolveUser(user);
    await this.data.assertDevice(relutionUser.uuid, action.deviceId);
    action = await this.actions.refreshAction(user, action);
    return toPortalAction(action);
  }

  async getApplicationIcon(
    user: PortalUser,
    appId: string,
  ): Promise<ApplicationIcon | null> {
    const relutionUser = await this.data.resolveUser(user);
    const app = (await this.data.permittedCatalog(relutionUser)).find(
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

  private async loadDeviceActions(deviceId: string) {
    return this.data.loadDeviceActions(deviceId);
  }

  private async targetIsInstalled(action: PersistedAction) {
    return this.data.targetIsInstalled(action);
  }
}

const TERMINAL = new Set<PersistedAction["state"]>([
  "succeeded",
  "failed",
  "cancelled",
]);
