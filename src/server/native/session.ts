import type { PortalUser } from "@/domain/models";
import { ApiError } from "@/server/http/api";
import { getActionRepository } from "@/server/persistence/runtime";
import { getRelutionGateway } from "@/server/relution";
import { hashNativeSecret, parseBearerToken } from "./validation";

export interface NativeRequestContext {
  tokenHash: string;
  user: PortalUser;
  deviceId: string;
  expiresAt: string;
}

export function requireNativeSession(request: Request): NativeRequestContext {
  const tokenHash = hashNativeSecret(parseBearerToken(request));
  const session = getActionRepository().authenticateNativeSession(tokenHash);
  if (!session) {
    throw new ApiError(
      401,
      "The native session has expired.",
      "SESSION_EXPIRED",
    );
  }
  return {
    tokenHash,
    user: session.owner,
    deviceId: session.deviceUuid,
    expiresAt: session.expiresAt,
  };
}

export async function assertNativeDeviceAssignment(
  context: NativeRequestContext,
) {
  const devices = await getRelutionGateway().listAssignedWindowsDevices(
    context.user,
  );
  const device = devices.find((candidate) => candidate.id === context.deviceId);
  if (!device) {
    const repository = getActionRepository();
    repository.revokeNativeSession(context.tokenHash);
    repository.recordSecurityEvent({
      event: "native_assignment_denied",
      outcome: "denied",
      owner: context.user,
      deviceUuid: context.deviceId,
    });
    throw new ApiError(
      403,
      "This Windows device is no longer assigned to your account.",
      "DEVICE_MATCH_FAILED",
    );
  }
  return device;
}
