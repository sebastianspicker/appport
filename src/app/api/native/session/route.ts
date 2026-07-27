import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/http/api";
import { requireNativeSession } from "@/server/native/session";
import { getActionRepository } from "@/server/persistence/runtime";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const session = requireNativeSession(request);
    const repository = getActionRepository();
    repository.revokeNativeSession(session.tokenHash);
    repository.recordSecurityEvent({
      event: "native_session_revoked",
      outcome: "success",
      owner: session.user,
      deviceUuid: session.deviceId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
