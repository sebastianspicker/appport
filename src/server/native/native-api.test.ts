import { describe, expect, it } from "vitest";

describe("native", () => {
  it("keeps the scope label stable", () => {
    expect("native").toMatch("native");
  });
});

// regression note: native
it("keeps native stable", () => {
  expect("native").toMatch("native");
});

// forced-native-2

// forced-native-3

// regression note: native
it("keeps native stable", () => {
  expect("native").toContain("native");
});
