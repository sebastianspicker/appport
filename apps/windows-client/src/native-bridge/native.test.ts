import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { native } from "./native";
import type { AppInstallState, NativeErrorCode } from "./types";
import nativeContract from "../../native-contract.json";

describe("native command boundary", () => {
  beforeEach(() => invoke.mockReset());

  const request = {
    authMethod: "personal_token" as const,
    relutionUsername: "ada",
    accessToken: "secret",
  };
  const commands: ReadonlyArray<{
    name: string;
    call: () => Promise<unknown>;
    expected: readonly unknown[];
  }> = [
    {
      name: "initial_view",
      call: native.initialView,
      expected: ["initial_view"],
    },
    {
      name: "connect",
      call: () => native.connect(request),
      expected: ["connect", { request }],
    },
    { name: "bootstrap", call: native.bootstrap, expected: ["bootstrap"] },
    {
      name: "list_apps",
      call: () => native.apps("updates"),
      expected: ["list_apps", { view: "updates" }],
    },
    {
      name: "request_action",
      call: () => native.act("firefox"),
      expected: ["request_action", { appId: "firefox" }],
    },
    {
      name: "get_action",
      call: () => native.action("action-1"),
      expected: ["get_action", { actionId: "action-1" }],
    },
    {
      name: "load_app_icon",
      call: () => native.icon("firefox"),
      expected: ["load_app_icon", { appId: "firefox" }],
    },
    { name: "sign_out", call: native.signOut, expected: ["sign_out"] },
    {
      name: "support_details",
      call: native.supportDetails,
      expected: ["support_details"],
    },
    {
      name: "generate_support_bundle",
      call: () => native.generateSupportBundle(true),
      expected: [
        "generate_support_bundle",
        { confirmedSupportIdentifiers: true },
      ],
    },
    {
      name: "open_support_folder",
      call: native.openSupportFolder,
      expected: ["open_support_folder"],
    },
    {
      name: "open_relution_portal",
      call: native.openRelutionPortal,
      expected: ["open_relution_portal"],
    },
  ];

  it("covers every registered native command", () => {
    expect(commands.map(({ name }) => name).sort()).toEqual(
      [...nativeContract.commands].sort(),
    );
  });

  it("shares the native enum contract", () => {
    const installStates: readonly AppInstallState[] = [
      "available",
      "update_available",
    ];
    const errorCodes: readonly NativeErrorCode[] = [
      "OFFLINE",
      "SESSION_EXPIRED",
      "AUTHORIZATION_DENIED",
      "DEVICE_MATCH_FAILED",
      "SERVER",
      "SUPPORT",
      "UNKNOWN",
    ];
    expect(nativeContract.installStates).toEqual(installStates);
    expect(nativeContract.nativeErrorCodes).toEqual(errorCodes);
  });

  it.each(commands)(
    "preserves the $name command wire contract",
    async ({ call, expected }) => {
      await call();
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke).toHaveBeenCalledWith(...expected);
    },
  );
});
