import { describe, expect, it } from "vitest";
import type { ClientProblem } from "../native-bridge/types";
import { copyFor, localeFor, problemCopy, text } from "./copy";

describe("localized copy", () => {
  it.each([
    ["en", text.en],
    ["de", text.de],
  ] as const)("selects the fixed %s bundle", (locale, expected) =>
    expect(copyFor(locale)).toBe(expected),
  );

  it.each([
    ["de", "de"],
    ["DE", "de"],
    ["de-DE", "de"],
    ["en-GB", "en"],
    ["fr", "en"],
    ["", "en"],
  ] as const)("normalizes %s to %s", (language, expected) =>
    expect(localeFor(language)).toBe(expected),
  );

  it.each([
    ["loading", "loading"],
    ["empty", "empty"],
    ["offline", "offline"],
    ["session-expired", "sessionExpired"],
    ["authorization-denied", "authorizationDenied"],
    ["device-match-failed", "deviceFailed"],
    ["server", "server"],
    ["unknown", "unknown"],
  ] as const)("maps %s to the matching copy", (problem, key) => {
    for (const locale of ["en", "de"] as const) {
      expect(problemCopy(locale, problem)).toBe(text[locale][key]);
    }
  });

  it("uses unknown copy for unexpected runtime problems", () => {
    expect(problemCopy("de", "unexpected" as ClientProblem)).toBe(
      text.de.unknown,
    );
  });

  it("keeps authorization and device guidance distinct", () => {
    expect(problemCopy("en", "authorization-denied").join(" ")).toMatch(
      /Relution/i,
    );
    expect(problemCopy("en", "authorization-denied")).not.toEqual(
      problemCopy("en", "device-match-failed"),
    );
  });
});
