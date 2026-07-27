import { apiErrorResponse } from "@/server/http/api";
import {
  assertNativeDeviceAssignment,
  requireNativeSession,
} from "@/server/native/session";
import { getRelutionGateway } from "@/server/relution";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ appId: string }> },
) {
  try {
    const native = requireNativeSession(request);
    await assertNativeDeviceAssignment(native);
    const { appId } = await context.params;
    const icon = await getRelutionGateway().getApplicationIcon(
      native.user,
      appId,
    );
    if (!icon) return new Response(null, { status: 404 });
    return new Response(Buffer.from(icon.bytes), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": icon.contentType,
        "Content-Length": String(icon.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
