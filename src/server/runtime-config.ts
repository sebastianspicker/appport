import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface LiveRuntimeConfig {
  baseUrl: URL;
  organizationUuid: string;
  tokenFile: string;
  sqlitePath: string;
  liveWritesEnabled: boolean;
  publicOrigin: string;
  readTimeoutMs: number;
  pageSize: number;
  maxPages: number;
  cacheTtlMs: number;
  actionCorrelationMs: number;
  actionVerificationMs: number;
  auditRetentionDays: number;
  nativeAppUuid?: string;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in live mode.`);
  return value;
}

function integer(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function fixedHttpsUrl(
  name: string,
  value: string,
  options: { rootOnly?: boolean } = {},
) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (options.rootOnly && url.pathname !== "/")
  ) {
    throw new Error(
      `${name} must be a fixed HTTPS URL without credentials, query, or fragment.`,
    );
  }
  return url;
}

function optionalIdentifier(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (value.length > 128 || value.includes("\0")) {
    throw new Error(`${name} must be a bounded Relution identifier.`);
  }
  return value;
}

let cachedConfig: LiveRuntimeConfig | undefined;

export function getLiveRuntimeConfig(): LiveRuntimeConfig {
  if (cachedConfig) return cachedConfig;

  const baseUrl = fixedHttpsUrl(
    "RELUTION_API_BASE_URL",
    required("RELUTION_API_BASE_URL"),
    { rootOnly: true },
  );
  const publicUrl = fixedHttpsUrl(
    "APPPORT_PUBLIC_ORIGIN",
    process.env.APPPORT_PUBLIC_ORIGIN ??
      process.env.APP_BASE_URL ??
      required("APPPORT_PUBLIC_ORIGIN"),
    { rootOnly: true },
  );
  const tokenFile = required("RELUTION_API_TOKEN_FILE");
  const tokenStat = statSync(tokenFile);
  if (!tokenStat.isFile()) {
    throw new Error("RELUTION_API_TOKEN_FILE must reference a regular file.");
  }
  if (process.env.NODE_ENV === "production" && (tokenStat.mode & 0o077) !== 0) {
    throw new Error(
      "RELUTION_API_TOKEN_FILE must reference a file without group or other permissions.",
    );
  }

  const sqlitePath = required("APPPORT_SQLITE_PATH");
  if (!isAbsolute(sqlitePath)) {
    throw new Error("APPPORT_SQLITE_PATH must be absolute.");
  }

  cachedConfig = {
    baseUrl,
    organizationUuid: required("RELUTION_ORGANIZATION_UUID"),
    tokenFile,
    sqlitePath,
    liveWritesEnabled:
      process.env.APPPORT_LIVE_WRITES_ENABLED?.toLowerCase() === "true",
    publicOrigin: publicUrl.origin,
    readTimeoutMs: integer(
      "APPPORT_READ_TIMEOUT_MS",
      15_000,
      1_000,
      60_000,
    ),
    pageSize: integer("APPPORT_PAGE_SIZE", 100, 1, 500),
    maxPages: integer("APPPORT_MAX_PAGES", 100, 1, 1_000),
    cacheTtlMs:
      integer("APPPORT_CACHE_TTL_SECONDS", 60, 0, 3_600) * 1_000,
    actionCorrelationMs:
      integer("APPPORT_ACTION_CORRELATION_SECONDS", 120, 10, 600) * 1_000,
    actionVerificationMs:
      integer("APPPORT_ACTION_VERIFY_SECONDS", 300, 30, 1_800) * 1_000,
    auditRetentionDays: integer(
      "APPPORT_AUDIT_RETENTION_DAYS",
      90,
      1,
      3_650,
    ),
    nativeAppUuid: optionalIdentifier("APPPORT_NATIVE_APP_UUID"),
  };
  return cachedConfig;
}

export function resetRuntimeConfigForTests() {
  cachedConfig = undefined;
}
