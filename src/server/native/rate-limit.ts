import { createHash } from "node:crypto";
import { MemoryRateLimiter } from "@/server/relution/rate-limit";

const connectLimiter = new MemoryRateLimiter(
  10,
  60_000,
  "Too many native sign-in requests. Try again shortly.",
  2_048,
);
const exchangeLimiter = new MemoryRateLimiter(
  10,
  60_000,
  "Too many native sign-in requests. Try again shortly.",
  2_048,
);
const globalConnectLimiter = new MemoryRateLimiter(100, 60_000);
const globalExchangeLimiter = new MemoryRateLimiter(100, 60_000);

function requestKey(request: Request) {
  const forwarded =
    process.env.APPPORT_TRUST_PROXY === "true"
      ? request.headers.get("x-real-ip")?.trim()
      : undefined;
  const value =
    forwarded && /^[0-9a-f:.]{3,64}$/i.test(forwarded)
      ? forwarded
      : "unidentified-client";
  return createHash("sha256").update(value).digest("hex");
}

export function assertNativeConnectRateLimit(request: Request) {
  globalConnectLimiter.assertAllowed("all-native-connects");
  connectLimiter.assertAllowed(requestKey(request));
}

export function assertNativeExchangeRateLimit(request: Request) {
  globalExchangeLimiter.assertAllowed("all-native-exchanges");
  exchangeLimiter.assertAllowed(requestKey(request));
}

export function resetNativeRateLimitsForTests() {
  connectLimiter.reset();
  exchangeLimiter.reset();
  globalConnectLimiter.reset();
  globalExchangeLimiter.reset();
}
