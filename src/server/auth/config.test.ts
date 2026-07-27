import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthSecret, requireOidcConfig } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production authentication configuration", () => {
  it("requires fixed HTTPS OIDC and public URLs", () => {
    vi.stubEnv("OIDC_ISSUER", "http://identity.example/realm");
    vi.stubEnv("OIDC_CLIENT_ID", "appport");
    vi.stubEnv("APP_BASE_URL", "https://apps.example");
    vi.stubEnv("OIDC_CLIENT_SECRET", "development-only");

    expect(() => requireOidcConfig()).toThrow("OIDC_ISSUER must be a fixed HTTPS URL");

    vi.stubEnv("OIDC_ISSUER", "https://identity.example/realm");
    vi.stubEnv("APP_BASE_URL", "https://apps.example/unexpected");
    expect(() => requireOidcConfig()).toThrow("APP_BASE_URL must be a fixed HTTPS URL");
  });

  it("does not accept an environment secret in production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "not-allowed-in-production-builds");
    vi.stubEnv("AUTH_SECRET_FILE", "");
    expect(() => getAuthSecret()).toThrow("AUTH_SECRET_FILE is required in production");
  });
});
