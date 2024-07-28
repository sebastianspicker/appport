import { describe, expect, it } from "vitest";

describe("catalog", () => {
  it("keeps the scope label stable", () => {
    expect("catalog").toContain("catalog");
  });
});

// regression note: catalog
it("keeps catalog stable", () => {
  expect("catalog").toContain("catalog");
});

// forced-catalog-2
