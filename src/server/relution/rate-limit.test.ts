import { describe, expect, it } from "vitest";
import { GatewayError } from "./errors";
import { MemoryRateLimiter } from "./rate-limit";

describe("MemoryRateLimiter", () => {
  it("limits a user within the configured window and resets afterward", () => {
    const limiter = new MemoryRateLimiter(2, 1_000);
    limiter.assertAllowed("user", 1_000);
    limiter.assertAllowed("user", 1_100);

    expect(() => limiter.assertAllowed("user", 1_200)).toThrowError(
      GatewayError,
    );
    expect(() => limiter.assertAllowed("user", 2_000)).not.toThrow();
  });

  it("keeps buckets separate between users", () => {
    const limiter = new MemoryRateLimiter(1, 1_000);
    limiter.assertAllowed("one", 1_000);
    expect(() => limiter.assertAllowed("two", 1_100)).not.toThrow();
  });

  it("bounds unique keys and evicts expired buckets", () => {
    const limiter = new MemoryRateLimiter(1, 1_000, "limited", 2);
    limiter.assertAllowed("one", 1_000);
    limiter.assertAllowed("two", 1_100);
    expect(() => limiter.assertAllowed("three", 1_200)).toThrowError(
      GatewayError,
    );
    expect(() => limiter.assertAllowed("three", 2_100)).not.toThrow();
  });
});
