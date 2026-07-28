import type {
  AvailableApp,
  AppSource,
  InstalledApplication,
} from "@/domain/models";
import type { PersistedAction } from "@/server/persistence";

export interface CatalogApp {
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

export interface InventoryApp {
  appId: string | null;
  packageId: string;
  name: string;
  versionId: string | null;
  versionLabel: string;
  source: AppSource | null;
  updateAvailable: boolean;
  iconPath: string | null;
}

function active(state: PersistedAction["state"]) {
  return ["reserved", "queued", "sent", "deferred", "verifying", "unknown"].includes(state);
}

export function activeActionFor(
  recent: PersistedAction[],
  deviceId: string,
  app: CatalogApp,
) {
  return recent.find(
    (action) =>
      action.deviceId === deviceId &&
      action.appId === app.id &&
      action.targetVersionId === app.releasedVersionId &&
      active(action.state),
  );
}

function installStateFor(
  installed: InventoryApp | undefined,
  current: PersistedAction | undefined,
) {
  if (current) return "action_active";
  if (!installed) return "not_installed";
  return installed.updateAvailable ? "update_available" : "installed";
}

function actionStateFor(current: PersistedAction | undefined) {
  if (!current) return null;
  return current.state === "reserved" ? "queued" : current.state;
}

function appIconUrl(app: CatalogApp) {
  return app.iconPath ? `/api/native/apps/${encodeURIComponent(app.id)}/icon` : null;
}

export function availableAppFor(
  app: CatalogApp,
  installed: InventoryApp | undefined,
  current: PersistedAction | undefined,
): AvailableApp {
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
    installState: installStateFor(installed, current),
    activeActionId: current?.id ?? null,
    activeActionState: actionStateFor(current),
    iconUrl: appIconUrl(app),
  };
}

export function installedAppFor(
  item: InventoryApp,
  app: CatalogApp | undefined,
): InstalledApplication {
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
}
