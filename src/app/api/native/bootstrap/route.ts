import { NextResponse } from "next/server";
import type { NativeBootstrap } from "@/domain/models";
import { apiErrorResponse } from "@/server/http/api";
import {
  assertNativeDeviceAssignment,
  requireNativeSession,
} from "@/server/native/session";
import { getRelutionGateway } from "@/server/relution";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = requireNativeSession(request);
    const device = await assertNativeDeviceAssignment(context);
    const applications = await getRelutionGateway().listApplications(
      context.user,
      context.deviceId,
    );
    const response: NativeBootstrap = {
      user: { displayName: context.user.displayName },
      device: {
        name: device.name,
        status: device.status,
        lastSeenAt: device.lastSeenAt,
      },
      sessionExpiresAt: context.expiresAt,
      updateCount: applications.filter(
        (application) => application.installState === "update_available",
      ).length,
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
