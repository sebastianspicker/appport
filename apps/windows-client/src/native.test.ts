import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { native } from "./native";

describe("native authentication bridge", () => {
  it("passes a tagged connection request to the native command", async () => {
    const request = {
      authMethod: "password" as const,
      relutionUsername: "ada",
      password: "ephemeral-password",
    };

    await native.connect(request);

    expect(invoke).toHaveBeenCalledWith("connect", { request });
  });

  it("loads the supported authentication methods from native", async () => {
    await native.authCapabilities();

    expect(invoke).toHaveBeenCalledWith("auth_capabilities");
  });
});
