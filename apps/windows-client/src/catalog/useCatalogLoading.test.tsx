import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogPhase } from "./types";
import type { AvailableApp, NativeBootstrap } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import {
  availableApp,
  catalogSnapshot,
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

function useCatalogLoadingHarness() {
  const mounted = useMounted();
  const generation = useRef(0);
  const [apps, setApps] = useState<AvailableApp[]>([]);
  const [bootstrap, setBootstrap] = useState<NativeBootstrap>();
  const [phase, setPhase] = useState<CatalogPhase>("loading");
  const [catalogRevision, setCatalogRevision] = useState("");
  const resolveView = useCallback(() => native.initialView(), []);
  const load = useCatalogLoading(undefined, resolveView, mounted, generation, {
    setCatalogRevision,
    setApps,
    setBootstrap,
    setPhase,
  });
  return { apps, bootstrap, generation, load, phase, catalogRevision };
}

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("catalog loading", () => {
  it("uses the resolved initial view and shows its catalog", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.loadCatalog).mockResolvedValue(
      catalogSnapshot([availableApp("edge", "Edge")]),
    );
    const { result } = renderHook(useCatalogLoadingHarness);
    await act(async () => {
      await result.current.load();
    });
    expect(native.loadCatalog).toHaveBeenCalledWith({
      view: "updates",
      forceRefresh: false,
    });
    expect(result.current.apps.map(({ id }) => id)).toEqual(["edge"]);
    expect(result.current.phase).toBe("ready");
  });

  it("suppresses an older catalog request that resolves after a newer one", async () => {
    const oldApps = deferred<ReturnType<typeof catalogSnapshot>>();
    const newApps = deferred<ReturnType<typeof catalogSnapshot>>();
    vi.mocked(native.loadCatalog)
      .mockReturnValueOnce(oldApps.promise)
      .mockReturnValueOnce(newApps.promise);
    const { result } = renderHook(useCatalogLoadingHarness);
    const oldLoad = result.current.load("apps");
    const newLoad = result.current.load("updates");
    newApps.resolve(
      catalogSnapshot(
        [availableApp("new")],
        nativeBootstrap({ availableCount: 7 }),
        "new",
      ),
    );
    await act(async () => {
      await newLoad;
    });
    oldApps.resolve(
      catalogSnapshot(
        [availableApp("old")],
        nativeBootstrap({ availableCount: 2 }),
        "old",
      ),
    );
    await act(async () => {
      await oldLoad;
    });
    expect(result.current.apps.map(({ id }) => id)).toEqual(["new"]);
    expect(result.current.bootstrap?.availableCount).toBe(7);
    expect(result.current.catalogRevision).toBe("new");
  });
});
