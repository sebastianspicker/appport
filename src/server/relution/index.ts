import type { RelutionGateway } from "./gateway";
import { getAuthMode, type AuthMode } from "@/server/auth/config";
import { LiveRelutionGateway } from "./live-gateway";
import { mockRelutionGateway } from "./mock-gateway";

let liveGateway: RelutionGateway | undefined;

export function getRelutionGateway(): RelutionGateway {
  const mode = process.env.RELUTION_GATEWAY_MODE ?? "mock";
  if (mode === "mock") return mockRelutionGateway;
  if (mode === "live") {
    assertGatewayModeCombination(mode, getAuthMode());
    liveGateway ??= new LiveRelutionGateway();
    return liveGateway;
  }
  throw new Error("RELUTION_GATEWAY_MODE must be mock or live.");
}

export function assertGatewayModeCombination(
  gatewayMode: "mock" | "live",
  authMode: AuthMode,
) {
  if (gatewayMode === "live" && authMode !== "oidc") {
    throw new Error("The live Relution gateway requires OIDC authentication.");
  }
}
