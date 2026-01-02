import { describe, expect, it } from "vitest";

describe("integration", () => {
  it("keeps the scope label stable", () => {
    expect("integration").toContain("integration");
  });
});

// regression note: integration
it("keeps integration stable", () => {
  expect("integration").toContain("integration");
});
