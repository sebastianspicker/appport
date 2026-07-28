import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NativeSessionExchangeResponse } from "@/domain/models";
import {
  ApiError,
  apiErrorResponse,
  readBoundedJson,
} from "@/server/http/api";
import { DeviceMatchError } from "@/server/native/device-match";
import {
  decodeNativeSessionExchange,
  hashNativeSecret,
  verifierChallenge,
} from "@/server/native/validation";
import { getActionRepository } from "@/server/persistence/runtime";
import { NativeIdentityBindingError } from "@/server/persistence/repository";
import { getRelutionGateway } from "@/server/relution";
import { assertNativeExchangeRateLimit } from "@/server/native/rate-limit";

export const runtime = "nodejs";

async function exchangeNativeSession(request: Request) {
  assertNativeExchangeRateLimit(request);
  const body = decodeNativeSessionExchange(await readBoundedJson(request, 8_192));
  const repository = getActionRepository();
  const grant = repository.consumeNativeAuthRequest(
    body.requestId,
    hashNativeSecret(body.code),
    verifierChallenge(body.verifier),
  );
  if (!grant) {
    throw new ApiError(401, "The native sign-in request is invalid or expired.");
  }
  const resolution = await getRelutionGateway().resolveCurrentWindowsDevice(
    grant.owner,
    body.deviceEvidence,
  );
  repository.assertNativeIdentityBinding(grant.owner, resolution.relutionUserUuid);
  const token = randomBytes(32).toString("base64url");
  const session = repository.createNativeSession({
    owner: grant.owner,
    tokenHash: hashNativeSecret(token),
    deviceUuid: resolution.device.id,
    evidenceDigest: resolution.evidenceDigest,
    clientVersion: body.clientVersion,
  });
  repository.recordSecurityEvent({
    event: "native_session_created",
    outcome: "success",
    owner: grant.owner,
    deviceUuid: resolution.device.id,
    requestId: body.requestId,
  });
  const response: NativeSessionExchangeResponse = {
    token,
    expiresAt: session.expiresAt,
    device: {
      name: resolution.device.name,
      status: resolution.device.status,
      lastSeenAt: resolution.device.lastSeenAt,
    },
  };
  return NextResponse.json(response, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

function nativeExchangeErrorResponse(error: unknown) {
  if (error instanceof DeviceMatchError || error instanceof NativeIdentityBindingError) {
    return apiErrorResponse(new ApiError(403, error.message, "DEVICE_MATCH_FAILED"));
  }
  return apiErrorResponse(error);
}

export async function POST(request: Request) {
  try {
    return await exchangeNativeSession(request);
  } catch (error) {
    return nativeExchangeErrorResponse(error);
  }
}
