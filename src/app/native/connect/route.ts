import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getPortalUser } from "@/server/auth/session";
import { ApiError, apiErrorResponse } from "@/server/http/api";
import { getActionRepository } from "@/server/persistence/runtime";
import {
  hashNativeSecret,
  parseNativeConnectParameters,
} from "@/server/native/validation";
import { assertNativeConnectRateLimit } from "@/server/native/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertNativeConnectRateLimit(request);
    const url = new URL(request.url);
    const parameters = parseNativeConnectParameters(url.searchParams);
    const repository = getActionRepository();
    repository.createNativeAuthRequest({
      requestId: parameters.requestId,
      challenge: parameters.challenge,
      stateHash: hashNativeSecret(parameters.state),
      loopbackPort: parameters.port,
    });
    repository.recordSecurityEvent({
      event: "native_handoff_created",
      outcome: "success",
      requestId: parameters.requestId,
    });

    const user = await getPortalUser();
    if (!user) {
      const returnTo = `${url.pathname}${url.search}`;
      return NextResponse.redirect(
        new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, url.origin),
        303,
      );
    }

    const code = randomBytes(32).toString("base64url");
    const authorized = repository.authorizeNativeAuthRequest(
      parameters.requestId,
      user,
      hashNativeSecret(code),
    );
    if (!authorized) {
      throw new ApiError(410, "The native sign-in request has expired.");
    }
    const callback = new URL(
      `http://127.0.0.1:${authorized.loopbackPort}/callback`,
    );
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", parameters.state);
    return NextResponse.redirect(callback, 303);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "NATIVE_AUTH_REQUEST_CONFLICT"
    ) {
      return apiErrorResponse(
        new ApiError(409, "The native sign-in request cannot be reused."),
      );
    }
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "NATIVE_AUTH_CAPACITY"
    ) {
      return apiErrorResponse(
        new ApiError(429, "Too many native sign-in requests are pending.", "RATE_LIMITED"),
      );
    }
    return apiErrorResponse(error);
  }
}
