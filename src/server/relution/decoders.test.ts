import { describe, expect, it } from "vitest";
import { decodeItems, decodeWrapper } from "./decoders";
import { mapRelutionState } from "./live-gateway";

describe("Relution response decoding", () => {
  it("accepts documented wrapper forms", () => {
    expect(
      decodeWrapper({ total: 1, results: [{ uuid: "one" }] }),
    ).toEqual({ total: 1, results: [{ uuid: "one" }] });
    expect(
      decodeItems({ nonpagedCount: 1, items: [{ uuid: "one" }] }),
    ).toEqual({ total: 1, results: [{ uuid: "one" }] });
  });

  it("fails closed for missing result arrays and invalid totals", () => {
    expect(() => decodeWrapper({ total: 0 })).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
    expect(() => decodeWrapper({ total: -1, results: [] })).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });
});

describe("Relution action mapping", () => {
  it.each([
    ["NEW", "queued"],
    ["PENDING", "queued"],
    ["PUSH_SENT", "queued"],
    ["DELIVERED", "sent"],
    ["DELIVERY_CONFIRMED", "sent"],
    ["NOT_NOW", "deferred"],
    ["EXECUTED", "verifying"],
    ["ERROR", "failed"],
    ["CANCELLED", "cancelled"],
    ["unexpected", "unknown"],
  ])("maps %s to %s", (relution, portal) => {
    expect(mapRelutionState(relution)).toBe(portal);
  });
});
