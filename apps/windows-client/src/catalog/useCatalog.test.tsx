import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import {
  availableApp,
  catalogSnapshot,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
} from "../testing/nativeMock";
import { useCatalog } from "./useCatalog";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../testing/nativeMock");
  return { native: createNativeMock() };
});

const useEnglishCatalog = () => useCatalog("en");

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("catalog loading", () => {
  it("uses the resolved initial view and shows its catalog", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.loadCatalog).mockResolvedValue(
      catalogSnapshot([availableApp("edge", "Edge")]),
    );
    const { result } = renderHook(useEnglishCatalog);
    await act(async () => {
      await result.current.catalog.load();
    });
    expect(native.loadCatalog).toHaveBeenCalledWith({
      view: "updates",
      forceRefresh: false,
    });
    expect(result.current.catalog.apps.map(({ id }) => id)).toEqual(["edge"]);
    expect(result.current.catalog.phase).toBe("ready");
  });

  it("suppresses an older catalog request that resolves after a newer one", async () => {
    const { result } = renderHook(useEnglishCatalog);
    await waitFor(() => expect(result.current.catalog.phase).toBe("empty"));
    const oldApps = deferred<ReturnType<typeof catalogSnapshot>>();
    const newApps = deferred<ReturnType<typeof catalogSnapshot>>();
    vi.mocked(native.loadCatalog)
      .mockReturnValueOnce(oldApps.promise)
      .mockReturnValueOnce(newApps.promise);
    const oldLoad = result.current.catalog.load("apps");
    const newLoad = result.current.catalog.load("updates");
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
    expect(result.current.catalog.apps.map(({ id }) => id)).toEqual(["new"]);
    expect(result.current.catalog.bootstrap?.availableCount).toBe(7);
    expect(result.current.catalog.catalogRevision).toBe("new");
  });
});
