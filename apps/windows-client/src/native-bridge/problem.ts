import type { ClientProblem, NativeError } from "./types";

const problemsByCode = {
  OFFLINE: "offline",
  SESSION_EXPIRED: "session-expired",
  AUTHORIZATION_DENIED: "authorization-denied",
  DEVICE_MATCH_FAILED: "device-match-failed",
  SERVER: "server",
} as const satisfies Partial<Record<NativeError["code"], ClientProblem>>;

export function problemFor(error: unknown): ClientProblem {
  const code = (error as Partial<NativeError> | null | undefined)?.code;
  return code && code in problemsByCode
    ? problemsByCode[code as keyof typeof problemsByCode]
    : "unknown";
}
