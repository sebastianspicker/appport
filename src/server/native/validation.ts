import { createHash } from "node:crypto";
import type {
  NativeDeviceEvidenceV1,
  NativeSessionExchangeRequest,
} from "@/domain/models";
import { ApiError } from "@/server/http/api";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const NATIVE_CONNECT_KEYS = ["challenge", "port", "requestId", "state"];

type NativeSessionFields = {
  requestId: string;
  code: string;
  verifier: string;
  clientVersion: string;
  locale: "en-US" | "de-DE";
};

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

function parseLoopbackPort(value: string): number | null {
  const port = Number(value);
  if (!/^[0-9]{4,5}$/.test(value) || !Number.isInteger(port)) return null;
  return port >= 1_024 && port <= 65_535 ? port : null;
}

function validConnectTokens(
  requestId: string,
  challenge: string,
  state: string,
) {
  return UUID.test(requestId) && BASE64URL_32.test(challenge) && BASE64URL_32.test(state);
}

function isNativeConnectPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function hasExpectedNativeConnectParameters(url: URL) {
  const actualKeys = [...url.searchParams.keys()].sort();
  const expectedKeysMatch = actualKeys.every(
    (key, index) => key === NATIVE_CONNECT_KEYS[index],
  );
  const keysAreUnique = NATIVE_CONNECT_KEYS.every(
    (key) => url.searchParams.getAll(key).length === 1,
  );
  return actualKeys.length === NATIVE_CONNECT_KEYS.length && expectedKeysMatch && keysAreUnique;
}

function isNativeSessionFields(value: Record<string, unknown>): value is NativeSessionFields & Record<string, unknown> {
  const requestId = value.requestId;
  const code = value.code;
  const verifier = value.verifier;
  const clientVersion = value.clientVersion;
  const locale = value.locale;
  const validTokens = [code, verifier].every(
    (token) => typeof token === "string" && BASE64URL_32.test(token),
  );
  const validRequestId = typeof requestId === "string" && UUID.test(requestId);
  const validClientVersion = typeof clientVersion === "string" && clientVersion.length >= 1 && clientVersion.length <= 64;
  const validLocale = locale === "en-US" || locale === "de-DE";
  return validRequestId && validTokens && validClientVersion && validLocale;
}

function nativeConnectUrlIsExpected(url: URL) {
  return (
    url.origin === "https://appport.invalid" &&
    url.pathname === "/native/connect" &&
    !url.hash &&
    hasExpectedNativeConnectParameters(url)
  );
}

function nativeConnectParameter(params: URLSearchParams, key: string) {
  return params.get(key) || "";
}

export function parseNativeConnectParameters(
  params: URLSearchParams,
): NativeConnectParameters {
  const requestId = nativeConnectParameter(params, "requestId");
  const challenge = nativeConnectParameter(params, "challenge");
  const state = nativeConnectParameter(params, "state");
  const rawPort = nativeConnectParameter(params, "port");
  const port = parseLoopbackPort(rawPort);
  if (!validConnectTokens(requestId, challenge, state) || port === null) {
    throw new ApiError(400, "The native sign-in request is invalid.");
  }
  return { requestId, challenge, state, port };
}

export function nativeConnectReturnTo(value: unknown): string | null {
  if (!isNativeConnectPath(value)) return null;
  try {
    const url = new URL(value, "https://appport.invalid");
    if (!nativeConnectUrlIsExpected(url)) {
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
  if (!isNativeSessionFields(body)) {
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
