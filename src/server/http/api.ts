import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type {
  ApiErrorCode,
  ApiErrorEnvelope,
} from "@relution/appport-contracts";
import { GatewayError } from "@/server/relution/errors";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ApiErrorCode = apiCodeForStatus(status),
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin =
    process.env.APPPORT_PUBLIC_ORIGIN ??
    (process.env.AUTH_MODE === "oidc" ? process.env.APP_BASE_URL : undefined);
  const allowedOrigins = new Set<string>();
  if (expectedOrigin) {
    allowedOrigins.add(new URL(expectedOrigin).origin);
  } else {
    allowedOrigins.add(new URL(request.url).origin);
    const host = request.headers.get("host");
    if (host) {
      const forwardedProtocol = request.headers
        .get("x-forwarded-proto")
        ?.split(",")[0]
        .trim();
      allowedOrigins.add(
        `${forwardedProtocol === "https" ? "https" : "http"}://${host}`,
      );
    }
  }
  if (!origin || !allowedOrigins.has(origin)) {
    throw new ApiError(403, "Cross-origin mutations are not allowed.");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new ApiError(403, "Cross-site mutations are not allowed.");
  }
}

export function assertJsonRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new ApiError(400, "Content-Type must be application/json.");
  }
}

export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  assertJsonRequest(request);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(413, "Request body is too large.");
  }
  if (!request.body) {
    throw new ApiError(400, "A JSON request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new ApiError(413, "Request body is too large.");
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

export function apiErrorResponse(error: unknown) {
  const requestId = randomUUID();
  if (error instanceof ApiError) {
    return errorResponse(error.status, error.code, error.message, requestId);
  }
  if (error instanceof GatewayError) {
    const statusByCode = {
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      INTEGRATION_AUTHENTICATION: 503,
      INTEGRATION_AUTHORIZATION: 503,
      INTEGRATION_UNAVAILABLE: 503,
      INVALID_RESPONSE: 502,
      INVALID_DEPLOYMENT: 422,
      LIVE_WRITES_DISABLED: 503,
    } as const;
    return errorResponse(
      statusByCode[error.code],
      error.code,
      error.message,
      requestId,
    );
  }

  console.error("api_request_failed", {
    requestId,
    error: error instanceof Error ? error.name : "UnknownError",
  });
  return errorResponse(
    500,
    "INTERNAL_ERROR",
    "The service could not complete this request.",
    requestId,
  );
}

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
) {
  const body: ApiErrorEnvelope = {
    error: { code, message, requestId },
  };
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

function apiCodeForStatus(status: number): ApiErrorCode {
  if (status === 400 || status === 413 || status === 415) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409 || status === 410) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL_ERROR";
}
