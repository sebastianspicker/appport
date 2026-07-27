import { describe, expect, it } from "vitest";
import {
  decodeNativeSessionExchange,
  nativeConnectReturnTo,
  parseBearerToken,
  parseNativeConnectParameters,
  verifierChallenge,
} from "./validation";

const requestId = "7be8b295-5087-42b9-bfb2-68de9e86baf7";
const value32 = "A".repeat(43);

describe("native request validation", () => {
  it("accepts a verifier-bound loopback request", () => {
    expect(
      parseNativeConnectParameters(
        new URLSearchParams({
          requestId,
          challenge: value32,
          state: value32,
          port: "49152",
        }),
      ),
    ).toEqual({
      requestId,
      challenge: value32,
      state: value32,
      port: 49152,
    });
  });

  it("rejects non-loopback-compatible ports and malformed challenges", () => {
    expect(() =>
      parseNativeConnectParameters(
        new URLSearchParams({
          requestId,
          challenge: "short",
          state: value32,
          port: "80",
        }),
      ),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("accepts only complete native connect return paths", () => {
    const returnTo =
      `/native/connect?requestId=${requestId}` +
      `&challenge=${value32}&state=${value32}&port=49152`;
    expect(nativeConnectReturnTo(returnTo)).toBe(returnTo);
    expect(nativeConnectReturnTo("/apps")).toBeNull();
    expect(nativeConnectReturnTo(`//example.test${returnTo}`)).toBeNull();
    expect(nativeConnectReturnTo(`${returnTo}&extra=value`)).toBeNull();
    expect(nativeConnectReturnTo(`${returnTo}#fragment`)).toBeNull();
  });

  it("decodes the bounded exchange contract", () => {
    expect(
      decodeNativeSessionExchange({
        requestId,
        code: value32,
        verifier: value32,
        clientVersion: "0.1.0",
        locale: "de-DE",
        deviceEvidence: {
          version: 1,
          hostname: "OFFICE-LAPTOP",
          biosSerial: "OFFICE-001",
        },
      }),
    ).toMatchObject({
      locale: "de-DE",
      deviceEvidence: { version: 1, hostname: "OFFICE-LAPTOP" },
    });
  });

  it("accepts only a fixed-size opaque bearer token", () => {
    expect(
      parseBearerToken(
        new Request("https://apps.example/api/native/bootstrap", {
          headers: { Authorization: `Bearer ${value32}` },
        }),
      ),
    ).toBe(value32);
    expect(() =>
      parseBearerToken(
        new Request("https://apps.example/api/native/bootstrap", {
          headers: { Authorization: "Bearer short" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ status: 401 }));
  });

  it("derives a base64url SHA-256 verifier challenge", () => {
    expect(verifierChallenge(value32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
