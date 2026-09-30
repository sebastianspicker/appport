import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import {
  availableApp,
  catalogSnapshot,
  deferred,
  resetNativeMockDefaults,
} from "../test/nativeMock";
import type { Catalog } from "./model";
import { useCatalog } from "./useCatalog";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../test/nativeMock");
  return { native: createNativeMock() };
});

function restartedApplication() {
  return availableApp("firefox", "firefox", {
    activeActionId: "restart-42",
    activeActionState: "queued",
    installState: "available",
  });
}

function appAction(
  state: AppAction["state"],
  overrides: Partial<AppAction> = {},
): AppAction {
  return {
    id: "action-42",
    appId: "firefox",
    deviceId: "device",
    intent: "install",
    state,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

const catalogLoads = () => vi.mocked(native.loadCatalog).mock.calls.length;

function expectTerminalReload(catalog: Catalog, loadsBefore: number) {
  expect(catalog.actions.get("firefox")?.state).toBe("succeeded");
  expect(catalog.polling.has("firefox")).toBe(false);
  expect(catalogLoads()).toBe(loadsBefore + 1);
}

/** Lets mocked native results and the React updates they trigger complete. */
async function settle() {
  for (let turn = 0; turn < 5; turn += 1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
}

async function renderCatalog(...apps: AvailableApp[]) {
  // Each native snapshot is a fresh array, as it is across the IPC boundary.
  vi.mocked(native.loadCatalog).mockImplementation(async () =>
    catalogSnapshot(apps.map((application) => ({ ...application }))),
  );
  const rendered = renderHook(() => useCatalog("en"));
  await settle();
  return rendered;
}

async function refreshCatalog(catalog: Catalog) {
  await act(async () => {
    await catalog.load();
  });
  await settle();
}

beforeEach(() => {
  resetNativeMockDefaults(vi.mocked(native));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("catalog action workflow", () => {
  it("hydrates a restarted active action once and resumes polling it", async () => {
    vi.mocked(native.action)
      .mockResolvedValueOnce(appAction("queued", { id: "restart-42" }))
      .mockResolvedValueOnce(appAction("succeeded", { id: "restart-42" }));
    const { result } = await renderCatalog(restartedApplication());
    await refreshCatalog(result.current.catalog);

    expect(native.action).toHaveBeenCalledTimes(1);
    expect(result.current.catalog.actions.get("firefox")?.id).toBe(
      "restart-42",
    );
    expect(result.current.catalog.polling.get("firefox")).toBe("polling");

    const loadsBefore = catalogLoads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await settle();

    expect(native.action).toHaveBeenCalledTimes(2);
    expectTerminalReload(result.current.catalog, loadsBefore);
  });

  it("ignores stale and mismatched hydration results", async () => {
    const stale = deferred<AppAction>();
    vi.mocked(native.action)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(
        appAction("queued", { appId: "other-app", id: "other-action" }),
      );
    const { result } = await renderCatalog(restartedApplication());

    // Clearing resets per-application action generations without a new session.
    act(() => {
      result.current.control.clear("session-expired");
    });
    stale.resolve(appAction("queued", { id: "restart-42" }));
    await settle();
    await refreshCatalog(result.current.catalog);

    expect(native.action).toHaveBeenCalledTimes(2);
    expect(result.current.catalog.actions).toEqual(new Map());
    expect(result.current.catalog.polling).toEqual(new Map());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient hydration failure on a later catalog refresh", async () => {
    vi.mocked(native.action)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(appAction("queued", { id: "restart-42" }));
    const { result } = await renderCatalog(restartedApplication());
    await refreshCatalog(result.current.catalog);

    expect(native.action).toHaveBeenCalledTimes(2);
    expect(result.current.catalog.actions.get("firefox")?.id).toBe(
      "restart-42",
    );
    expect(result.current.catalog.polling.get("firefox")).toBe("polling");
  });

  it("pauses after a transient poll failure and resumes to a terminal result", async () => {
    vi.mocked(native.act).mockResolvedValue(appAction("queued"));
    vi.mocked(native.action)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(appAction("succeeded"));
    const { result } = await renderCatalog(availableApp());

    await act(async () => {
      await result.current.catalog.startAction(availableApp());
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.catalog.polling.get("firefox")).toBe("paused");

    const loadsBefore = catalogLoads();
    act(() => {
      result.current.catalog.resumeAction("firefox");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await settle();

    expectTerminalReload(result.current.catalog, loadsBefore);
  });

  it("reloads the catalog after a terminal hydrated result", async () => {
    vi.mocked(native.action).mockResolvedValue(appAction("succeeded"));
    const { result } = await renderCatalog(
      availableApp("firefox", "firefox", {
        activeActionId: "action-42",
        activeActionState: "succeeded",
        installState: "available",
      }),
    );

    expect(result.current.catalog.actions.get("firefox")?.state).toBe(
      "succeeded",
    );
    expect(result.current.catalog.polling.has("firefox")).toBe(false);
    // The initial load plus exactly one reload for the terminal result.
    expect(native.loadCatalog).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending poll before its native status request", async () => {
    vi.mocked(native.act).mockResolvedValue(appAction("queued"));
    const { result } = await renderCatalog(availableApp());

    await act(async () => {
      await result.current.catalog.startAction(availableApp());
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      result.current.control.cancel();
    });
    expect(result.current.control.currentGeneration()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(native.action).not.toHaveBeenCalled();
  });

  it("keeps concurrent applications pending and rejects duplicate submissions", async () => {
    const first = deferred<AppAction>();
    const second = deferred<AppAction>();
    vi.mocked(native.act).mockImplementation((appId) => {
      if (appId === "alpha") return first.promise;
      if (appId === "beta") return second.promise;
      throw new Error("unexpected application " + appId);
    });
    const { result } = await renderCatalog();
    let firstStart!: Promise<void>;
    let secondStart!: Promise<void>;

    act(() => {
      firstStart = result.current.catalog.startAction(availableApp("alpha"));
      secondStart = result.current.catalog.startAction(availableApp("beta"));
      void result.current.catalog.startAction(availableApp("alpha"));
    });

    expect(native.act).toHaveBeenCalledTimes(2);
    expect(native.act).toHaveBeenNthCalledWith(1, "alpha");
    expect(native.act).toHaveBeenNthCalledWith(2, "beta");
    expect(result.current.catalog.busyApps).toEqual(new Set(["alpha", "beta"]));

    await act(async () => {
      first.resolve(
        appAction("failed", { id: "alpha-action", appId: "alpha" }),
      );
      await firstStart;
    });
    expect(result.current.catalog.busyApps).toEqual(new Set(["beta"]));

    await act(async () => {
      second.resolve(appAction("failed", { id: "beta-action", appId: "beta" }));
      await secondStart;
    });
    expect(result.current.catalog.busyApps).toEqual(new Set());
  });

  it("does not let a stale completion clear a newer generation start", async () => {
    const stale = deferred<AppAction>();
    const current = deferred<AppAction>();
    vi.mocked(native.act)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const { result } = await renderCatalog();
    let staleStart!: Promise<void>;
    let currentStart!: Promise<void>;

    act(() => {
      staleStart = result.current.catalog.startAction(availableApp("alpha"));
    });
    act(() => {
      result.current.control.clear("session-expired");
      currentStart = result.current.catalog.startAction(availableApp("alpha"));
    });

    await act(async () => {
      stale.resolve(
        appAction("failed", { id: "stale-action", appId: "alpha" }),
      );
      await staleStart;
    });
    expect(result.current.catalog.busyApps).toEqual(new Set(["alpha"]));
    expect(result.current.catalog.actions.has("alpha")).toBe(false);

    await act(async () => {
      current.resolve(
        appAction("failed", { id: "current-action", appId: "alpha" }),
      );
      await currentStart;
    });
    expect(result.current.catalog.busyApps).toEqual(new Set());
    expect(result.current.catalog.actions.get("alpha")?.id).toBe(
      "current-action",
    );
    expect(native.act).toHaveBeenCalledTimes(2);
  });
});
