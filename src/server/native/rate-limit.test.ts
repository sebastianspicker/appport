import { afterEach, describe, expect, it } from "vitest";
import {
  assertNativeConnectRateLimit,
  resetNativeRateLimitsForTests,
} from "./rate-limit";

const previousTrustProxy = process.env.APPPORT_TRUST_PROXY;

afterEach(() => {
  resetNativeRateLimitsForTests();
  if (previousTrustProxy === undefined) {
    delete process.env.APPPORT_TRUST_PROXY;
  } else {
    process.env.APPPORT_TRUST_PROXY = previousTrustProxy;
  }
});

describe("native rate-limit identity", () => {
  it("ignores caller-supplied forwarding headers unless proxy trust is explicit", () => {
    delete process.env.APPPORT_TRUST_PROXY;
    for (let index = 0; index < 10; index += 1) {
      assertNativeConnectRateLimit(
        new Request("https://apps.example/native/connect", {
          headers: { "X-Real-IP": `2001:db8::${index}` },
        }),
      );
    }
    expect(() =>
      assertNativeConnectRateLimit(
        new Request("https://apps.example/native/connect", {
          headers: { "X-Real-IP": "2001:db8::ffff" },
        }),
      ),
    ).toThrow();
  });

  it("uses a validated proxy-provided address only in trusted proxy mode", () => {
    process.env.APPPORT_TRUST_PROXY = "true";
    for (let index = 0; index < 10; index += 1) {
      assertNativeConnectRateLimit(
        new Request("https://apps.example/native/connect", {
          headers: { "X-Real-IP": "192.0.2.10" },
        }),
      );
    }
    expect(() =>
      assertNativeConnectRateLimit(
        new Request("https://apps.example/native/connect", {
          headers: { "X-Real-IP": "192.0.2.11" },
        }),
      ),
    ).not.toThrow();
  });
});
