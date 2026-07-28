import { NextResponse } from "next/server";
import { assertSameOrigin, apiErrorResponse, ApiError } from "@/server/http/api";
import {
  createMockSessionValue,
  MOCK_SESSION_COOKIE,
} from "@/server/auth/session";
import { getAuthMode, secureCookiesEnabled } from "@/server/auth/config";
import { nativeConnectReturnTo } from "@/server/native/validation";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    assertSameOrigin(request);
    if (!origin) {
      throw new ApiError(403, "Cross-origin mutations are not allowed.");
    }
    if (getAuthMode() !== "mock") {
      throw new ApiError(404, "Mock sign-in is disabled.");
    }
    const form = await request.formData();
    const returnTo = nativeConnectReturnTo(form.get("returnTo")) ?? "/";
    const response = NextResponse.redirect(
      new URL(returnTo, origin),
      303,
    );
    response.cookies.set(MOCK_SESSION_COOKIE, createMockSessionValue(), {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookiesEnabled(),
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
