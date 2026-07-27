import { afterEach, describe, expect, it } from "vitest";
import {
  ApiError,
  apiErrorResponse,
  assertJsonRequest,
  assertSameOrigin,
  readBoundedJson,
} from "./api";

const previousOrigin = process.env.APPPORT_PUBLIC_ORIGIN;
const previousAuthMode = process.env.AUTH_MODE;
const previousBaseUrl = process.env.APP_BASE_URL;

afterEach(() => {
  if (previousOrigin === undefined) delete process.env.APPPORT_PUBLIC_ORIGIN;
  else process.env.APPPORT_PUBLIC_ORIGIN = previousOrigin;
  if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = previousAuthMode;
  if (previousBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = previousBaseUrl;
});

describe("mutation request validation", () => {
  it("requires a same-origin browser request", () => {
    delete process.env.APPPORT_PUBLIC_ORIGIN;
    process.env.AUTH_MODE = "mock";
    const sameOrigin = new Request("http://localhost:3000/api/action", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(() => assertSameOrigin(sameOrigin)).not.toThrow();

    const missing = new Request("http://localhost:3000/api/action", {
      method: "POST",
    });
    expect(() => assertSameOrigin(missing)).toThrowError(
      expect.objectContaining({ status: 403 }),
    );

    const crossSite = new Request("http://localhost:3000/api/action", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(() => assertSameOrigin(crossSite)).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it("pins production-style mutations to the configured public origin", () => {
    process.env.APPPORT_PUBLIC_ORIGIN = "https://apps.example";
    const request = new Request("http://internal:3000/api/action", {
      method: "POST",
      headers: {
        Origin: "https://apps.example",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("requires JSON for application actions", () => {
    expect(() =>
      assertJsonRequest(
        new Request("https://apps.example/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertJsonRequest(
        new Request("https://apps.example/api/action", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("bounds JSON independently of Content-Length", async () => {
    const accepted = new Request("https://apps.example/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
    await expect(readBoundedJson(accepted, 7)).resolves.toEqual({ a: 1 });

    const oversized = new Request("https://apps.example/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"value":true}',
    });
    await expect(readBoundedJson(oversized, 8)).rejects.toMatchObject({
      status: 413,
      code: "BAD_REQUEST",
    });
  });

  it("returns stable error codes and request identifiers", async () => {
    const response = apiErrorResponse(
      new ApiError(401, "Expired.", "SESSION_EXPIRED"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "SESSION_EXPIRED",
        message: "Expired.",
        requestId: expect.any(String),
      },
    });
  });
});
