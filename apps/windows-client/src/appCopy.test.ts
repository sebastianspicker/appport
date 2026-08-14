import { describe, expect, it } from "vitest";
import { copyFor, localeFor, problemCopy, text } from "./appCopy";
import type { ClientProblem } from "./models";

type ProblemCopyKey =
  | "loading"
  | "empty"
  | "offline"
  | "sessionExpired"
  | "deviceFailed"
  | "server"
  | "action"
  | "unknown";

const problemCases: readonly [ClientProblem, ProblemCopyKey][] = [
  ["loading", "loading"],
  ["empty", "empty"],
  ["offline", "offline"],
  ["session-expired", "sessionExpired"],
  ["device-match-failed", "deviceFailed"],
  ["server", "server"],
  ["action", "action"],
  ["unknown", "unknown"],
];

describe("app copy", () => {
  it.each([
    ["en", text.en],
    ["de", text.de],
  ] as const)("selects the fixed %s bundle", (locale, expected) => {
    expect(copyFor(locale)).toBe(expected);
  });

  it.each([
    ["de", "de"],
    ["DE", "de"],
    ["de-DE", "de"],
    ["en-GB", "en"],
    ["fr", "en"],
    ["", "en"],
  ] as const)("normalizes %s to %s", (language, expected) => {
    expect(localeFor(language)).toBe(expected);
  });

  it.each(problemCases)(
    "maps %s to the matching copy tuple",
    (problem, copyKey) => {
      for (const locale of ["en", "de"] as const) {
        expect(problemCopy(locale, problem)).toBe(text[locale][copyKey]);
      }
    },
  );

  it("uses unknown copy for an unexpected runtime problem", () => {
    expect(problemCopy("de", "unexpected" as ClientProblem)).toBe(
      text.de.unknown,
    );
  });
});
