import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/http/api";
import {
  assertNativeDeviceAssignment,
  requireNativeSession,
} from "@/server/native/session";
import { getRelutionGateway } from "@/server/relution";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  try {
    const native = requireNativeSession(request);
    await assertNativeDeviceAssignment(native);
    const { actionId } = await context.params;
    if (actionId.length > 128) {
      throw new ApiError(400, "Resource identifier is too long.");
    }
    const action = await getRelutionGateway().getAction(
      native.user,
      actionId,
    );
    if (action.deviceId !== native.deviceId) {
      throw new ApiError(404, "The application action was not found.");
    }
    return NextResponse.json(
      { action },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
