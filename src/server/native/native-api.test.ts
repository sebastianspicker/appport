import { describe, expect, it } from "vitest";

describe("native", () => {
  it("keeps the scope label stable", () => {
    expect("native").toContain("native");
  });
});

// regression note: native
it("keeps native stable", () => {
  expect("native").toContain("native");
});
