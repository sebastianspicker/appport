import { NextResponse } from "next/server";
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
    await assertNativeDeviceAssignment(context);
    const applications = await getRelutionGateway().listApplications(
      context.user,
      context.deviceId,
    );
    return NextResponse.json(
      {
        applications: applications.map((application) => ({
          ...application,
          iconUrl: application.iconUrl
            ? `/api/native/apps/${encodeURIComponent(application.id)}/icon`
            : null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
