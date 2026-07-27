import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { PortalUser } from "@/domain/models";
import { getAuth } from "./better-auth";
import { getAuthMode, getAuthSecret, requireOidcConfig } from "./config";

export const MOCK_SESSION_COOKIE = "appport-mock-session";
const MOCK_SESSION_PAYLOAD = "mock-user";

export function createMockSessionValue() {
  const signature = createHmac("sha256", getAuthSecret())
    .update(MOCK_SESSION_PAYLOAD)
    .digest("base64url");
  return `${MOCK_SESSION_PAYLOAD}.${signature}`;
}

function isValidMockSession(value: string | undefined) {
  if (!value) {
    return false;
  }
  const [payload, signature] = value.split(".");
  if (payload !== MOCK_SESSION_PAYLOAD || !signature) {
    return false;
  }
  const expected = createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function getPortalUser(): Promise<PortalUser | null> {
  if (getAuthMode() === "mock") {
    const cookieStore = await cookies();
    if (!isValidMockSession(cookieStore.get(MOCK_SESSION_COOKIE)?.value)) {
      return null;
    }
    return {
      id: "mock-user",
      issuer: "urn:appport:mock",
      subject: "mock-user",
      displayName: "Alex Morgan",
      relutionUsername: "alex.morgan",
    };
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }
  const user = session.user as typeof session.user & {
    relutionUsername?: string | null;
  };
  const relutionUsername = user.relutionUsername?.trim();
  if (!relutionUsername) {
    return null;
  }
  return {
    id: user.id,
    issuer: requireOidcConfig().issuer,
    subject: user.id,
    displayName: user.name,
    relutionUsername,
  };
}
