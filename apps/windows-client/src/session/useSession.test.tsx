import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogPhase } from "../catalog/types";
import type { AvailableApp, NativeBootstrap } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import {
  createNativeMock,
  resetNativeMockDefaults,
  signOutOutcome,
} from "../test/nativeMock";
import { useActionWorkflow } from "../catalog/useCatalogActions";
import {
  useMounted,
  usePollTimerRegistry,
} from "../catalog/useCatalogLifecycle";
import { useConnect, useSignOut } from "./useSession";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../test/nativeMock");
  return { native: createNativeMock() };
});

function harness() {
  const mounted = useMounted();
  const generation = useRef(0);
  const timers = usePollTimerRegistry();
  const [apps, setApps] = useState<AvailableApp[]>([
    { id: "old" } as AvailableApp,
  ]);
  const [bootstrap, setBootstrap] = useState<NativeBootstrap | undefined>(
    {} as NativeBootstrap,
  );
  const [phase, setPhase] = useState<CatalogPhase>("ready");
  const cancel = useRef(
    vi.fn(() => {
      generation.current += 1;
      timers.clear();
    }),
  ).current;
  const load = useRef(vi.fn().mockResolvedValue(undefined)).current;
  const actions = useActionWorkflow("en", mounted, generation, load, timers);
  const connect = useConnect(
    "en",
    load,
    cancel,
    actions.resetActions,
    generation,
    setPhase,
  );
  const signOut = useSignOut(
    "en",
    cancel,
    { setApps, setBootstrap, setPhase },
    actions.resetActions,
  );
  const client = { connect, signOut };
  return { apps, bootstrap, cancel, client, generation, load, phase };
}

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("client session operations", () => {
  it("connects after cancelling prior work and reloads the catalog", async () => {
    vi.mocked(native.connect).mockResolvedValue({
      backgroundCheckRegistered: true,
    });
    const { result } = renderHook(harness);
    await act(async () => {
      await result.current.client.connect.connect({
        authMethod: "personal_token",
        relutionUsername: "ada",
        accessToken: "secret",
      });
    });
    expect(result.current.cancel).toHaveBeenCalledTimes(1);
    expect(native.connect).toHaveBeenCalledWith({
      authMethod: "personal_token",
      relutionUsername: "ada",
      accessToken: "secret",
    });
    expect(result.current.load).toHaveBeenCalledTimes(1);
  });

  it("clears local session state only after native credential removal", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ notificationStateCleared: false }),
    );
    const { result } = renderHook(harness);
    await act(async () => {
      await result.current.client.signOut.signOut();
    });
    expect(result.current.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.apps).toEqual([]);
    expect(result.current.bootstrap).toBeUndefined();
    expect(result.current.phase).toBe("session-expired");
    expect(result.current.client.signOut.signOutWarning).toContain(
      "Signed out locally",
    );
  });

  it("retains the session when the native credential cannot be removed", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ credentialRemoved: false }),
    );
    const { result } = renderHook(harness);
    await act(async () => {
      await result.current.client.signOut.signOut();
    });
    expect(result.current.apps).toHaveLength(1);
    expect(result.current.bootstrap).toBeDefined();
    expect(result.current.phase).toBe("ready");
  });
});
