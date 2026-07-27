import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveRuntimeConfig } from "@/server/runtime-config";
import { RelutionClient } from "./client";

const directories: string[] = [];

function config(): LiveRuntimeConfig {
  const directory = mkdtempSync(join(tmpdir(), "appport-client-"));
  directories.push(directory);
  const tokenFile = join(directory, "token");
  writeFileSync(tokenFile, "test-token", { mode: 0o600 });
  return {
    baseUrl: new URL("https://relution.example"),
    organizationUuid: "organization-1",
    tokenFile,
    sqlitePath: join(directory, "actions.sqlite"),
    liveWritesEnabled: false,
    publicOrigin: "https://apps.example",
    readTimeoutMs: 5_000,
    pageSize: 100,
    maxPages: 100,
    cacheTtlMs: 60_000,
    actionCorrelationMs: 120_000,
    actionVerificationMs: 300_000,
    auditRetentionDays: 90,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RelutionClient", () => {
  it("pins the origin, tenant, and service-token header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    const client = new RelutionClient(config());

    await client.get("/api/management/v1/example");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://relution.example/api/management/v1/example?tenantOrganizationUuid=organization-1",
    );
    expect((init?.headers as Record<string, string>)["X-User-Access-Token"]).toBe(
      "test-token",
    );
    expect(init?.redirect).toBe("error");
  });

  it("retries a retryable read but never retries a mutation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("", { status: 503, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    const client = new RelutionClient(config());

    await client.get("/api/management/v1/example");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response("", { status: 503, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    await client.query("/api/management/v1/query", { getItems: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("connection lost"));
    await expect(
      client.post("/api/management/v1/example", { value: true }),
    ).rejects.toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects paths outside the fixed API boundary and malformed JSON", async () => {
    const client = new RelutionClient(config());
    await expect(client.get("https://other.example/api/data")).rejects.toMatchObject(
      { code: "INVALID_RESPONSE" },
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not-json"));
    await expect(
      client.get("/api/management/v1/example"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("stops reading an oversized chunked response", async () => {
    const chunk = new Uint8Array(600 * 1024);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { headers: { "Content-Type": "image/png" } }),
    );

    await expect(
      new RelutionClient(config()).getBinary("/api/management/v1/icon"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(cancelled).toBe(true);
  });
});
