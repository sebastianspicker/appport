import { NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  readBoundedJson,
} from "@/server/http/api";
import {
  assertNativeDeviceAssignment,
  requireNativeSession,
} from "@/server/native/session";
import { getRelutionGateway } from "@/server/relution";

export const runtime = "nodejs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function idempotencyKeyFrom(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const idempotencyKey = "idempotencyKey" in body ? body.idempotencyKey : undefined;
  return typeof idempotencyKey === "string" && UUID.test(idempotencyKey)
    ? idempotencyKey
    : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ appId: string }> },
) {
  try {
    const native = requireNativeSession(request);
    await assertNativeDeviceAssignment(native);
    const body = await readBoundedJson(request, 1_024);
    const idempotencyKey = idempotencyKeyFrom(body);
    if (!idempotencyKey) {
      throw new ApiError(400, "A valid idempotencyKey is required.");
    }
    const { appId } = await context.params;
    if (appId.length > 128) {
      throw new ApiError(400, "Resource identifier is too long.");
    }
    const result = await getRelutionGateway().requestAction(
      native.user,
      native.deviceId,
      appId,
      idempotencyKey,
    );
    return NextResponse.json(
      { action: result.action },
      {
        status: result.created ? 202 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
