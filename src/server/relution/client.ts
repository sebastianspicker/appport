import { readFileSync } from "node:fs";
import { GatewayError } from "./errors";
import type { LiveRuntimeConfig } from "@/server/runtime-config";

const MAX_JSON_BYTES = 10 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

interface RequestOptions {
  query?: URLSearchParams;
  body?: unknown;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.min(seconds * 1_000, 5_000));
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.min(date - Date.now(), 5_000));
  }
  return null;
}

export class RelutionClient {
  constructor(private readonly config: LiveRuntimeConfig) {}

  async get(path: string, query?: URLSearchParams): Promise<unknown> {
    return this.request("GET", path, { query });
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, { body });
  }

  async query(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchWithReadRetries("POST", path, { body });
    return this.decodeJsonResponse(response);
  }

  async getBinary(
    path: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const response = await this.fetchWithReadRetries("GET", path);
    if (response.status === 404) return null;
    await this.assertSuccess(response);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) {
      await response.body?.cancel();
      throw new GatewayError("INVALID_RESPONSE", "Application icon is too large.");
    }
    const bytes = await readLimitedBody(
      response,
      1024 * 1024,
      "Application icon is too large.",
    );
    return {
      bytes,
      contentType: response.headers.get("content-type")?.split(";")[0] ?? "",
    };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions,
  ) {
    const response =
      method === "GET"
        ? await this.fetchWithReadRetries(method, path, options)
        : await this.fetchOnce(method, path, options);
    return this.decodeJsonResponse(response);
  }

  private async decodeJsonResponse(response: Response) {
    await this.assertSuccess(response);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
      await response.body?.cancel();
      throw new GatewayError(
        "INVALID_RESPONSE",
        "Relution returned an oversized response.",
      );
    }
    const bytes = await readLimitedBody(
      response,
      MAX_JSON_BYTES,
      "Relution returned an oversized response.",
    );
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } catch {
      throw new GatewayError(
        "INVALID_RESPONSE",
        "Relution returned malformed JSON.",
      );
    }
  }

  private async fetchWithReadRetries(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions = {},
  ) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchOnce(method, path, options);
        if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) {
          return response;
        }
        await response.body?.cancel();
        const retryAfter = safeRetryAfter(response.headers.get("retry-after"));
        await wait(retryAfter ?? 150 * 2 ** attempt + Math.random() * 100);
      } catch (error) {
        lastError = error;
        if (
          (error instanceof GatewayError &&
            error.code !== "INTEGRATION_UNAVAILABLE") ||
          attempt === 2
        ) {
          throw error;
        }
        await wait(150 * 2 ** attempt + Math.random() * 100);
      }
    }
    throw lastError;
  }

  private async fetchOnce(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions,
  ) {
    if (!path.startsWith("/api/")) {
      throw new GatewayError("INVALID_RESPONSE", "Invalid Relution API path.");
    }
    const url = new URL(path, this.config.baseUrl.origin);
    if (url.origin !== this.config.baseUrl.origin) {
      throw new GatewayError("INVALID_RESPONSE", "Invalid Relution API origin.");
    }
    const query = new URLSearchParams(options.query);
    query.set("tenantOrganizationUuid", this.config.organizationUuid);
    url.search = query.toString();

    let token: string;
    try {
      token = readFileSync(this.config.tokenFile, "utf8").trim();
    } catch {
      throw new GatewayError(
        "INTEGRATION_AUTHENTICATION",
        "Relution authentication is unavailable.",
      );
    }
    if (!token) {
      throw new GatewayError(
        "INTEGRATION_AUTHENTICATION",
        "Relution authentication is unavailable.",
      );
    }
    try {
      return await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.readTimeoutMs),
        headers: {
          Accept: "application/json",
          "X-User-Access-Token": token,
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(
        "INTEGRATION_UNAVAILABLE",
        "Relution could not be reached.",
      );
    }
  }

  private async assertSuccess(response: Response) {
    if (response.ok) return;
    await response.body?.cancel();
    if (response.status === 401) {
      throw new GatewayError(
        "INTEGRATION_AUTHENTICATION",
        "Relution authentication failed.",
      );
    }
    if (response.status === 403) {
      throw new GatewayError(
        "INTEGRATION_AUTHORIZATION",
        "The Relution service account lacks a required permission.",
      );
    }
    if (response.status === 404) {
      throw new GatewayError("NOT_FOUND", "The Relution resource was not found.");
    }
    if (response.status === 422) {
      throw new GatewayError(
        "INVALID_DEPLOYMENT",
        "Relution rejected the deployment request.",
      );
    }
    throw new GatewayError(
      "INTEGRATION_UNAVAILABLE",
      "Relution could not complete the request.",
    );
  }
}

async function readLimitedBody(
  response: Response,
  maximumBytes: number,
  oversizedMessage: string,
) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new GatewayError("INVALID_RESPONSE", oversizedMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
