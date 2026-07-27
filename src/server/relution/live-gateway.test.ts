import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalUser } from "@/domain/models";
import { createActionRepository } from "@/server/persistence";
import type { LiveRuntimeConfig } from "@/server/runtime-config";
import type { RelutionClient } from "./client";
import { LiveRelutionGateway } from "./live-gateway";

const directories: string[] = [];

const portalUser: PortalUser = {
  id: "oidc-user",
  issuer: "https://identity.example.test",
  subject: "subject-1",
  displayName: "Alex Morgan",
  relutionUsername: "alex.morgan",
};

function wrapper(results: Array<Record<string, unknown>>) {
  return { results, total: results.length };
}

function makeGateway(options?: {
  deploymentResponse?: unknown;
  inventoryVersionId?: string | null;
  inventoryUpdateAvailable?: boolean;
  inventoryAppId?: string | null;
  permitApp?: boolean;
  assignedDevice?: boolean;
}) {
  const directory = mkdtempSync(join(tmpdir(), "live-gateway-test-"));
  directories.push(directory);
  const repository = createActionRepository(join(directory, "actions.sqlite"));
  const deploymentResponse =
    options && "deploymentResponse" in options
      ? options.deploymentResponse
      : wrapper([{ successful: true }]);
  let inventoryVersionId =
    options && "inventoryVersionId" in options
      ? options.inventoryVersionId
      : "version-old";
  const inventoryAppId =
    options && "inventoryAppId" in options
      ? options.inventoryAppId
      : "app-1";

  const client = {
    query: vi.fn(async (path: string) => {
      if (path.includes("/security/users/baseInfo/query")) {
        return wrapper([
          {
            uuid: "relution-user-1",
            name: "alex.morgan",
            organizationUuid: "organization-1",
            activated: true,
          },
        ]);
      }
      if (path.includes("/devices/baseInfo/query")) {
        return wrapper(
          options?.assignedDevice === false
            ? []
            : [
                {
                  uuid: "device-1",
                  name: "Laptop",
                  platform: "WINDOWS",
                  status: "COMPLIANT",
                  userUuid: "relution-user-1",
                  organizationUuid: "organization-1",
                },
              ],
        );
      }
      if (path.includes("/installedApps/baseInfo/query")) {
        if (inventoryVersionId === undefined) return wrapper([]);
        return wrapper([
          {
            identifier: "Contoso.App",
            name: "Contoso App",
            appUuid: inventoryAppId,
            versionUuid: inventoryVersionId,
            hasUpdateAvailable: options?.inventoryUpdateAvailable ?? true,
          },
        ]);
      }
      throw new Error(`Unexpected query path: ${path}`);
    }),
    get: vi.fn(async (path: string) => {
      if (path === "/api/management/v1/content/apps/baseInfo") {
        return wrapper([
          {
            uuid: "app-1",
            name: "Contoso App",
            subType: "WINGET",
            platforms: ["WINDOWS"],
            internalName: "Contoso.App",
            versions: {
              RELEASE: { uuid: "version-release", versionName: "2.0" },
            },
          },
        ]);
      }
      if (path.includes("/security/users/") && path.endsWith("/groups")) {
        return { groups: [] };
      }
      if (path.includes("/permissions/RELEASE")) {
        return wrapper(
          options?.permitApp === false
            ? []
            : [
                {
                  read: true,
                  userGroupInfo: { uuid: "relution-user-1", type: "USER" },
                },
              ],
        );
      }
      if (path.endsWith("/installedApps")) return wrapper([]);
      if (path.endsWith("/actions")) return wrapper(deviceActions);
      throw new Error(`Unexpected GET path: ${path}`);
    }),
    post: vi.fn(async () => deploymentResponse),
  };

  const config: LiveRuntimeConfig = {
    baseUrl: new URL("https://relution.example.test"),
    organizationUuid: "organization-1",
    tokenFile: join(directory, "unused-token"),
    sqlitePath: join(directory, "actions.sqlite"),
    liveWritesEnabled: true,
    publicOrigin: "https://appport.example.test",
    readTimeoutMs: 5_000,
    pageSize: 100,
    maxPages: 10,
    cacheTtlMs: 0,
    actionCorrelationMs: 10_000,
    actionVerificationMs: 30_000,
    auditRetentionDays: 90,
  };
  const gateway = new LiveRelutionGateway(
    config,
    client as unknown as RelutionClient,
    () => repository,
  );
  let deviceActions: Array<Record<string, unknown>> = [];
  return {
    gateway,
    repository,
    client,
    setInventoryVersionId(value: string | null) {
      inventoryVersionId = value;
    },
    setDeviceActions(value: Array<Record<string, unknown>>) {
      deviceActions = value;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("LiveRelutionGateway mutation safety", () => {
  it("requires exact inventory verification after Relution reports execution", async () => {
    const {
      gateway,
      repository,
      setDeviceActions,
      setInventoryVersionId,
    } = makeGateway();
    const submitted = await gateway.requestAction(
      portalUser,
      "device-1",
      "app-1",
      "05000000-0000-4000-8000-000000000001",
    );
    expect(submitted).toMatchObject({
      created: true,
      action: { state: "queued" },
    });

    setDeviceActions([
      {
        uuid: "relution-action-1",
        type: "DEPLOY_WINGET_APP",
        state: "EXECUTED",
        creationDate: Date.now(),
        details: {
          appUuid: "app-1",
          versionUuid: "version-release",
          appInternalName: "Contoso.App",
        },
      },
    ]);
    await expect(
      gateway.getAction(portalUser, submitted.action.id),
    ).resolves.toMatchObject({ state: "verifying" });

    setInventoryVersionId("version-release");
    await expect(
      gateway.getAction(portalUser, submitted.action.id),
    ).resolves.toMatchObject({ state: "succeeded" });
    repository.close();
  });

  it("marks a malformed post-dispatch response unknown and keeps it locked", async () => {
    const { gateway, repository, client } = makeGateway({
      deploymentResponse: wrapper([]),
    });
    await expect(
      gateway.requestAction(
        portalUser,
        "device-1",
        "app-1",
        "10000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    expect(repository.listRecentActions(portalUser, 10)[0]).toMatchObject({
      state: "unknown",
      errorCode: "SUBMISSION_UNCERTAIN",
    });
    await expect(
      gateway.requestAction(
        portalUser,
        "device-1",
        "app-1",
        "10000000-0000-4000-8000-000000000002",
      ),
    ).resolves.toMatchObject({
      created: false,
      action: { state: "unknown" },
    });
    expect(client.post).toHaveBeenCalledTimes(1);
    repository.close();
  });

  it("records an explicit Relution rejection as failed", async () => {
    const { gateway, repository } = makeGateway({
      deploymentResponse: wrapper([{ successful: false }]),
    });
    await expect(
      gateway.requestAction(
        portalUser,
        "device-1",
        "app-1",
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ code: "INVALID_DEPLOYMENT" });
    expect(repository.listRecentActions(portalUser, 10)[0]).toMatchObject({
      state: "failed",
      errorCode: "SUBMISSION_REJECTED",
    });
    repository.close();
  });

  it("fails closed when installed identity or target-version evidence is inconsistent", async () => {
    const missingVersion = makeGateway({ inventoryVersionId: null });
    await expect(
      missingVersion.gateway.requestAction(
        portalUser,
        "device-1",
        "app-1",
        "30000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(missingVersion.client.post).not.toHaveBeenCalled();
    missingVersion.repository.close();

    const alreadyCurrent = makeGateway({
      inventoryVersionId: "version-release",
      inventoryUpdateAvailable: true,
    });
    await expect(
      alreadyCurrent.gateway.requestAction(
        portalUser,
        "device-1",
        "app-1",
        "30000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(alreadyCurrent.client.post).not.toHaveBeenCalled();
    alreadyCurrent.repository.close();
  });

  it("reauthorizes device assignment and app permission before deployment", async () => {
    const deniedApp = makeGateway({ permitApp: false });
    await expect(
      deniedApp.gateway.requestAction(
        portalUser,
        "device-1",
        "app-1",
        "40000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deniedApp.client.post).not.toHaveBeenCalled();
    deniedApp.repository.close();

    const reassignedDevice = makeGateway({ assignedDevice: false });
    await expect(
      reassignedDevice.gateway.requestAction(
        portalUser,
        "device-1",
        "app-1",
        "40000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(reassignedDevice.client.post).not.toHaveBeenCalled();
    reassignedDevice.repository.close();
  });
});
