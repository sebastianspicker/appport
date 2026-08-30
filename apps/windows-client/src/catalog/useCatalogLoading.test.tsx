import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogPhase } from "./types";
import type { AvailableApp, NativeBootstrap } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import {
  availableApp,
  createNativeMock,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
} from "../test/nativeMock";
import { useCatalogLoading } from "./useCatalogLoading";
import { useMounted } from "./useCatalogLifecycle";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../test/nativeMock");
  return { native: createNativeMock() };
});

function harness() {
  const mounted = useMounted();
  const generation = useRef(0);
  const [apps, setApps] = useState<AvailableApp[]>([]);
  const [bootstrap, setBootstrap] = useState<NativeBootstrap>();
  const [phase, setPhase] = useState<CatalogPhase>("loading");
  const resolveView = useCallback(() => native.initialView(), []);
  const load = useCatalogLoading(undefined, resolveView, mounted, generation, {
    setApps,
    setBootstrap,
    setPhase,
  });
  return { apps, bootstrap, generation, load, phase };
}

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("catalog loading", () => {
  it("uses the resolved initial view and shows its catalog", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.apps).mockResolvedValue([availableApp("edge", "Edge")]);
    const { result } = renderHook(harness);
    await act(async () => {
      await result.current.load();
    });
    expect(native.apps).toHaveBeenCalledWith("updates");
    expect(result.current.apps.map(({ id }) => id)).toEqual(["edge"]);
    expect(result.current.phase).toBe("ready");
  });

  it("suppresses an older catalog request that resolves after a newer one", async () => {
    const oldApps = deferred<AvailableApp[]>();
    const newApps = deferred<AvailableApp[]>();
    vi.mocked(native.bootstrap).mockResolvedValue(nativeBootstrap());
    vi.mocked(native.apps)
      .mockReturnValueOnce(oldApps.promise)
      .mockReturnValueOnce(newApps.promise);
    const { result } = renderHook(harness);
    const oldLoad = result.current.load("apps");
    const newLoad = result.current.load("updates");
    newApps.resolve([availableApp("new")]);
    await act(async () => {
      await newLoad;
    });
    oldApps.resolve([availableApp("old")]);
    await act(async () => {
      await oldLoad;
    });
    expect(result.current.apps.map(({ id }) => id)).toEqual(["new"]);
  });
});
