import { describe, expect, it } from "vitest";
import { assertGatewayModeCombination } from "./index";

describe("Relution gateway configuration", () => {
  it("rejects mock authentication for the live gateway", () => {
    expect(() => assertGatewayModeCombination("live", "mock")).toThrow(
      "The live Relution gateway requires OIDC authentication.",
    );
  });

  it("allows only the intended mock/mock and live/OIDC combinations", () => {
    expect(() => assertGatewayModeCombination("mock", "mock")).not.toThrow();
    expect(() => assertGatewayModeCombination("mock", "oidc")).not.toThrow();
    expect(() => assertGatewayModeCombination("live", "oidc")).not.toThrow();
  });
});
