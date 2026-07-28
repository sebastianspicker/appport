import type { AppSource, ManagedDevice, NativeDeviceEvidenceV1, PortalUser } from "@/domain/models";
import { matchCurrentDevice, type DeviceMatchCandidate } from "@/server/native/device-match";
import type { LiveRuntimeConfig } from "@/server/runtime-config";
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
import type { CatalogApp, InventoryApp } from "./application-mappers";
import { RelutionClient } from "./client";

export interface RelutionUser {
  uuid: string;
  username: string;
}

const WINDOWS_SUBTYPES = new Map<string, AppSource>([
  ["WINGET", "winget"],
  ["WINDOWS_MSI", "windows_msi"],
  ["WINDOWS_EXE", "windows_exe"],
]);
const CACHE_LIMIT = 256;
const catalogCache = new Map<string, { expiresAt: number; value: Promise<CatalogApp[]> }>();

function epochTimestamp(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

function sourceFromSubtype(value: unknown): AppSource | null {
  return typeof value === "string" ? WINDOWS_SUBTYPES.get(value) ?? null : null;
}

function sourceFromApplicationSource(value: unknown): AppSource | null {
  if (value === "INSTALLED_BY_WINGET") return "winget";
  if (value === "INSTALLED_BY_COMPANION") return "windows_exe";
  return null;
}

function requiredSecondString(value: JsonRecord, first: string, second: string) {
  return stringField(value, first, false) ?? stringField(value, second);
}

function optionalFirstString(value: JsonRecord, first: string, second: string) {
  return stringField(value, first, false) ?? stringField(value, second, false);
}

function publisherFor(developer: JsonRecord | null) {
  if (!developer) return null;
  return optionalFirstString(developer, "name", "companyName");
}

function inventorySource(item: JsonRecord) {
  const subtype = sourceFromSubtype(item.appSubType);
  return subtype ?? sourceFromApplicationSource(item.applicationSource);
}

function updateAvailableFor(item: JsonRecord, status: JsonRecord | undefined) {
  const direct = booleanField(item, "hasUpdateAvailable");
  if (direct !== null) return direct;
  return status ? booleanField(status, "hasUpdateAvailable") ?? false : false;
}

function catalogAppFor(item: JsonRecord, config: LiveRuntimeConfig): CatalogApp | null {
  const source = sourceFromSubtype(item.subType);
  if (!source || !Array.isArray(item.platforms) || !item.platforms.includes("WINDOWS")) return null;
  const release = optionalRecordField(recordField(item, "versions"), "RELEASE");
  if (!release) return null;
  const appId = stringField(item, "uuid");
  if (appId === config.nativeAppUuid) return null;
  const developer = optionalRecordField(item, "developerInformation");
  return { id: appId, name: requiredSecondString(item, "name", "defaultName"), description: stringField(item, "description", false), publisher: publisherFor(developer), source, packageIdentifier: stringField(item, "internalName", false), releasedVersionId: stringField(release, "uuid"), releasedVersionLabel: stringField(release, "versionName", false), iconPath: stringField(item, "icon", false) };
}

function inventoryAppFor(item: JsonRecord, statusByApp: Map<string, JsonRecord>): InventoryApp | null {
  const packageId = stringField(item, "identifier", false); const name = stringField(item, "name", false);
  if (!packageId || !name) return null;
  const appId = stringField(item, "appUuid", false); const status = appId ? statusByApp.get(appId) : undefined;
  return { appId, packageId, name, versionId: stringField(item, "versionUuid", false), versionLabel: optionalFirstString(item, "versionToShow", "versionName") ?? "Unknown", source: inventorySource(item), updateAvailable: updateAvailableFor(item, status), iconPath: stringField(item, "iconUrl", false) };
}

export class LiveGatewayData {
  constructor(
    private readonly config: LiveRuntimeConfig,
    private readonly client: RelutionClient,
  ) {}

  async resolveUser(user: PortalUser): Promise<RelutionUser> {
    const results = await this.postPages("/api/management/v1/security/users/baseInfo/query", {
      searches: [user.relutionUsername.trim()], getItems: true, getNonpagedCount: true,
    });
    const expected = user.relutionUsername.trim().toLowerCase();
    const matches = results.flatMap((item): RelutionUser[] => {
      const username = stringField(item, "name");
      const organization = stringField(item, "organizationUuid");
      if (username.trim().toLowerCase() !== expected || organization !== this.config.organizationUuid || booleanField(item, "activated") !== true) return [];
      return [{ uuid: stringField(item, "uuid"), username }];
    });
    if (matches.length !== 1) throw new GatewayError("FORBIDDEN", "The portal identity could not be mapped to one active Relution user.");
    return matches[0];
  }

  async loadDevices(userUuid: string): Promise<ManagedDevice[]> {
    return (await this.loadDeviceCandidates(userUuid)).map((device) => ({
      id: device.id, name: device.name, platform: device.platform, status: device.status,
      serialNumber: device.serialNumber, lastSeenAt: device.lastSeenAt,
    }));
  }

  async resolveCurrentWindowsDevice(user: PortalUser, evidence: NativeDeviceEvidenceV1) {
    const relutionUser = await this.resolveUser(user);
    const matched = matchCurrentDevice(evidence, await this.loadDeviceCandidates(relutionUser.uuid));
    return {
      device: { id: matched.device.id, name: matched.device.name, platform: matched.device.platform, status: matched.device.status, serialNumber: matched.device.serialNumber, lastSeenAt: matched.device.lastSeenAt },
      evidenceDigest: matched.evidenceDigest, relutionUserUuid: relutionUser.uuid,
    };
  }

  async assertDevice(userUuid: string, deviceId: string) {
    const device = (await this.loadDevices(userUuid)).find((candidate) => candidate.id === deviceId);
    if (!device) throw new GatewayError("FORBIDDEN", "The selected device is not assigned to this user.");
    return device;
  }

  async permittedCatalog(user: RelutionUser) {
    const now = Date.now();
    const existing = catalogCache.get(user.uuid);
    if (existing && existing.expiresAt > now) return existing.value;
    for (const [key, value] of catalogCache) if (value.expiresAt <= now) catalogCache.delete(key);
    if (catalogCache.size >= CACHE_LIMIT) {
      const oldestUser = catalogCache.keys().next().value;
      if (oldestUser) catalogCache.delete(oldestUser);
    }
    const value = this.loadPermittedCatalog(user);
    catalogCache.set(user.uuid, { expiresAt: now + this.config.cacheTtlMs, value });
    value.catch(() => catalogCache.delete(user.uuid));
    return value;
  }

  async loadPermittedCatalog(user: RelutionUser) {
    const raw = await this.getPages("/api/management/v1/content/apps/baseInfo", new URLSearchParams([["getItems", "true"], ["getNonpagedCount", "true"], ["extend", "versions"], ["locale", "en"]]));
    const candidates = raw.flatMap((item) => {
      const app = catalogAppFor(item, this.config);
      return app ? [app] : [];
    });
    const directGroups = await this.loadDirectGroups(user.uuid);
    const membershipCache = new Map<string, Promise<boolean>>();
    const permitted: CatalogApp[] = [];
    for (let offset = 0; offset < candidates.length; offset += 8) {
      const batch = candidates.slice(offset, offset + 8);
      const decisions = await Promise.all(batch.map((app) => this.canReadApp(app.id, user.uuid, directGroups, membershipCache)));
      for (let index = 0; index < batch.length; index += 1) if (decisions[index]) permitted.push(batch[index]);
    }
    return permitted.sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
  }

  async loadInventory(deviceId: string): Promise<InventoryApp[]> {
    const [v2, v1] = await Promise.all([
      this.postPages(`/api/management/v2/devices/${encodeURIComponent(deviceId)}/installedApps/baseInfo/query`, { getItems: true, getNonpagedCount: true }),
      this.getPages(`/api/management/v1/devices/${encodeURIComponent(deviceId)}/installedApps`, new URLSearchParams([["getItems", "true"], ["getNonpagedCount", "true"], ["locale", "en"]])),
    ]);
    const statusByApp = new Map(v1.flatMap((item): Array<[string, JsonRecord]> => { const appId = stringField(item, "appUuid", false); return appId ? [[appId, item]] : []; }));
    return v2.flatMap((item) => {
      const app = inventoryAppFor(item, statusByApp);
      return app ? [app] : [];
    });
  }

  async loadDeviceActions(deviceId: string) {
    const query = new URLSearchParams([["limit", String(this.config.pageSize)], ["offset", "0"], ["sortOrder", "-creationDate"], ["getItems", "true"], ["getNonpagedCount", "true"], ["getPings", "false"]]);
    const wrapper = decodeWrapper(await this.client.get(`/api/management/v1/devices/${encodeURIComponent(deviceId)}/actions`, query));
    return wrapper.results.flatMap((value) => {
      const type = stringField(value, "type");
      if (type !== "DEPLOY_WINGET_APP" && type !== "DEPLOY_DESKTOP_APP" && type !== "DEPLOY_CLASSIC_APP") return [];
      const details = optionalRecordField(value, "details");
      const code = numberField(value, "errorCode");
      return [{ uuid: stringField(value, "uuid"), state: stringField(value, "state"), type, creationDate: numberField(value, "creationDate") ?? 0, errorCode: code === null ? null : `RELUTION_${code}`, appUuid: details ? stringField(details, "appUuid", false) : null, versionUuid: details ? stringField(details, "versionUuid", false) : null, packageIdentifier: details ? stringField(details, "appInternalName", false) : null }];
    });
  }

  async targetIsInstalled(action: { deviceId: string; appId: string; targetVersionId: string }) {
    return (await this.loadInventory(action.deviceId)).some((item) => item.appId === action.appId && item.versionId === action.targetVersionId);
  }

  private async loadDeviceCandidates(userUuid: string) {
    const results = await this.postPages("/api/management/v2/devices/baseInfo/query", { filter: { type: "logOp", operation: "AND", filters: [{ type: "string", fieldName: "userUuid", value: userUuid }, { type: "stringEnum", fieldName: "platform", values: ["WINDOWS"] }] }, sortOrder: { sortFields: [{ name: "lastConnectionDate", ascending: false }] }, getItems: true, getNonpagedCount: true });
    return results.flatMap((item): Array<ManagedDevice & DeviceMatchCandidate> => {
      const platform = stringField(item, "platform"); const status = stringField(item, "status");
      if (platform !== "WINDOWS" || (status !== "COMPLIANT" && status !== "NONCOMPLIANT" && status !== "INACTIVE") || stringField(item, "userUuid") !== userUuid || stringField(item, "organizationUuid") !== this.config.organizationUuid) return [];
      const uuid = stringField(item, "uuid");
      return [{ id: uuid, uuid, deviceId: stringField(item, "deviceId", false), name: stringField(item, "name"), platform: "WINDOWS", status, serialNumber: stringField(item, "serialNumber", false), lastSeenAt: epochTimestamp(numberField(item, "lastConnectionDate")) }];
    });
  }

  private async loadDirectGroups(userUuid: string) {
    const value = await this.client.get(`/api/management/v1/security/users/${encodeURIComponent(userUuid)}/groups`);
    if (!isRecord(value)) throw new GatewayError("INVALID_RESPONSE", "Relution returned an unexpected response.");
    return new Set(arrayField(value, "groups").map((group) => stringField(group, "uuid")));
  }

  private async canReadApp(appId: string, userUuid: string, directGroups: Set<string>, membershipCache: Map<string, Promise<boolean>>) {
    const wrapper = decodeWrapper(await this.client.get(`/api/management/v1/content/apps/${encodeURIComponent(appId)}/permissions/RELEASE`));
    for (const permission of wrapper.results) {
      if (booleanField(permission, "read") !== true) continue;
      const role = recordField(permission, "userGroupInfo"); const roleUuid = stringField(role, "uuid"); const roleType = stringField(role, "type");
      if (roleType === "USER" && roleUuid === userUuid) return true;
      if (roleType !== "GROUP") continue;
      if (directGroups.has(roleUuid)) return true;
      let membership = membershipCache.get(roleUuid);
      if (!membership) { membership = this.groupContainsUser(roleUuid, userUuid); membershipCache.set(roleUuid, membership); }
      if (await membership) return true;
    }
    return false;
  }

  private async groupContainsUser(groupUuid: string, userUuid: string) {
    const query = new URLSearchParams([["recursive", "true"], ["getItems", "true"], ["getNonpagedCount", "true"], ["filter", JSON.stringify({ type: "string", fieldName: "uuid", value: userUuid })]]);
    return (await this.getItemPages(`/api/management/v1/security/groups/${encodeURIComponent(groupUuid)}/members`, query)).some((item) => stringField(item, "uuid") === userUuid);
  }

  private async postPages(path: string, base: Record<string, unknown>) { return this.collectPages((page) => this.client.query(path, { ...base, limit: this.config.pageSize, offset: page * this.config.pageSize }), decodeWrapper); }
  private async getPages(path: string, base: URLSearchParams) { return this.collectPages((page) => { const query = new URLSearchParams(base); query.set("limit", String(this.config.pageSize)); query.set("offset", String(page * this.config.pageSize)); return this.client.get(path, query); }, decodeWrapper); }
  private async getItemPages(path: string, base: URLSearchParams) { return this.collectPages((page) => { const query = new URLSearchParams(base); query.set("limit", String(this.config.pageSize)); query.set("offset", String(page * this.config.pageSize)); return this.client.get(path, query); }, decodeItems); }
  private async collectPages(load: (page: number) => Promise<unknown>, decode: typeof decodeWrapper) {
    const collected: JsonRecord[] = [];
    for (let page = 0; page < this.config.maxPages; page += 1) {
      const wrapper = decode(await load(page)); collected.push(...wrapper.results);
      if (wrapper.total !== null && wrapper.total < collected.length) throw new GatewayError("INVALID_RESPONSE", "Relution returned inconsistent pagination metadata.");
      if (wrapper.results.length < this.config.pageSize || (wrapper.total !== null && collected.length >= wrapper.total)) return collected;
    }
    throw new GatewayError("INVALID_RESPONSE", "Relution pagination exceeded the configured limit.");
  }
}
