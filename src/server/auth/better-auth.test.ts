import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuth, resetAuthForTests } from "./better-auth";

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
});

describe("Better Auth session policy", () => {
  it("uses an absolute eight-hour browser session", async () => {
    vi.stubEnv("AUTH_MODE", "mock");
    vi.stubEnv("AUTH_SECRET", "test-only-browser-session-secret");
    resetAuthForTests();

    const context = await getAuth().$context;

    expect(context.sessionConfig.expiresIn).toBe(8 * 60 * 60);
    expect(context.options.session?.disableSessionRefresh).toBe(true);
    expect(context.options.session?.cookieCache?.maxAge).toBe(8 * 60 * 60);
  });
});
