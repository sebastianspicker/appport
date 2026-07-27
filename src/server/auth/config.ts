export type AuthMode = "mock" | "oidc";

import { readFileSync, statSync } from "node:fs";
import { fixedHttpsUrl } from "@/server/runtime-config";

function readSecret(
  valueName: string,
  fileName: string,
  options?: { developmentFallback?: string },
) {
  const secretFile = process.env[fileName];
  if (secretFile) {
    const stat = statSync(secretFile);
    if (!stat.isFile()) {
      throw new Error(`${fileName} must reference a regular file.`);
    }
    if (process.env.NODE_ENV === "production" && (stat.mode & 0o077) !== 0) {
      throw new Error(
        `${fileName} must reference a file without group or other permissions.`,
      );
    }
    const value = readFileSync(secretFile, "utf8").trim();
    if (!value) {
      throw new Error(`${fileName} references an empty secret file.`);
    }
    return value;
  }
  if (process.env.NODE_ENV !== "production") {
    return process.env[valueName] ?? options?.developmentFallback;
  }
  throw new Error(`${fileName} is required in production.`);
}

export function getAuthMode(): AuthMode {
  const mode = process.env.AUTH_MODE;
  if (mode === "mock" || mode === "oidc") {
    return mode;
  }
  if (process.env.NODE_ENV === "test") {
    return "mock";
  }
  throw new Error("AUTH_MODE must be set to either mock or oidc.");
}

export function getAuthSecret() {
  const secret = readSecret("AUTH_SECRET", "AUTH_SECRET_FILE", {
    developmentFallback: "local-development-only-appport-secret",
  });
  if (secret) {
    if (process.env.NODE_ENV === "production" && secret.length < 32) {
      throw new Error("AUTH_SECRET must contain at least 32 characters.");
    }
    return secret;
  }
  throw new Error("AUTH_SECRET is required.");
}

export function secureCookiesEnabled() {
  if (process.env.COOKIE_SECURE === "false" && getAuthMode() === "mock") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

export function requireOidcConfig() {
  const keys = [
    "OIDC_ISSUER",
    "OIDC_CLIENT_ID",
    "APP_BASE_URL",
  ] as const;
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing OIDC configuration: ${missing.join(", ")}`);
  }

  return {
    issuer: fixedHttpsUrl("OIDC_ISSUER", process.env.OIDC_ISSUER!).href.replace(
      /\/$/,
      "",
    ),
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: readSecret(
      "OIDC_CLIENT_SECRET",
      "OIDC_CLIENT_SECRET_FILE",
    )!,
    baseUrl: fixedHttpsUrl("APP_BASE_URL", process.env.APP_BASE_URL!, {
      rootOnly: true,
    }).origin,
    usernameClaim: process.env.OIDC_USERNAME_CLAIM ?? "preferred_username",
  };
}
