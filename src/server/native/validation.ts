import { createHash } from "node:crypto";
import type {
  NativeDeviceEvidenceV1,
  NativeSessionExchangeRequest,
} from "@/domain/models";
import { ApiError } from "@/server/http/api";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;

export interface NativeConnectParameters {
  requestId: string;
  challenge: string;
  state: string;
  port: number;
}

export function hashNativeSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifierChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function parseNativeConnectParameters(
  params: URLSearchParams,
): NativeConnectParameters {
  const requestId = params.get("requestId") ?? "";
  const challenge = params.get("challenge") ?? "";
  const state = params.get("state") ?? "";
  const rawPort = params.get("port") ?? "";
  const port = Number(rawPort);
  if (
    !UUID.test(requestId) ||
    !BASE64URL_32.test(challenge) ||
    !BASE64URL_32.test(state) ||
    !/^[0-9]{4,5}$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1_024 ||
    port > 65_535
  ) {
    throw new ApiError(400, "The native sign-in request is invalid.");
  }
  return { requestId, challenge, state, port };
}

export function nativeConnectReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(value, "https://appport.invalid");
    const expectedKeys = ["challenge", "port", "requestId", "state"];
    const actualKeys = [...url.searchParams.keys()].sort();
    if (
      url.origin !== "https://appport.invalid" ||
      url.pathname !== "/native/connect" ||
      url.hash ||
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index]) ||
      expectedKeys.some((key) => url.searchParams.getAll(key).length !== 1)
    ) {
      return null;
    }
    parseNativeConnectParameters(url.searchParams);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function optionalEvidence(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 256) {
    throw new ApiError(400, "Native device evidence is invalid.");
  }
  return value;
}

function decodeEvidence(value: unknown): NativeDeviceEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Native device evidence is required.");
  }
  const evidence = value as Record<string, unknown>;
  if (
    evidence.version !== 1 ||
    typeof evidence.hostname !== "string" ||
    evidence.hostname.length < 1 ||
    evidence.hostname.length > 256
  ) {
    throw new ApiError(400, "Native device evidence is invalid.");
  }
  return {
    version: 1,
    hostname: evidence.hostname,
    entDmid: optionalEvidence(evidence.entDmid),
    smbiosUuid: optionalEvidence(evidence.smbiosUuid),
    biosSerial: optionalEvidence(evidence.biosSerial),
  };
}

export function decodeNativeSessionExchange(
  value: unknown,
): NativeSessionExchangeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "The native session request is invalid.");
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.requestId !== "string" ||
    !UUID.test(body.requestId) ||
    typeof body.code !== "string" ||
    !BASE64URL_32.test(body.code) ||
    typeof body.verifier !== "string" ||
    !BASE64URL_32.test(body.verifier) ||
    typeof body.clientVersion !== "string" ||
    body.clientVersion.length < 1 ||
    body.clientVersion.length > 64 ||
    (body.locale !== "en-US" && body.locale !== "de-DE")
  ) {
    throw new ApiError(400, "The native session request is invalid.");
  }
  return {
    requestId: body.requestId,
    code: body.code,
    verifier: body.verifier,
    clientVersion: body.clientVersion,
    locale: body.locale,
    deviceEvidence: decodeEvidence(body.deviceEvidence),
  };
}

export function parseBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new ApiError(401, "Native authentication is required.");
  }
  const token = authorization.slice("Bearer ".length);
  if (!BASE64URL_32.test(token)) {
    throw new ApiError(401, "Native authentication is required.");
  }
  return token;
}
