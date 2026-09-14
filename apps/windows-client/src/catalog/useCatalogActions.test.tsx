import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import { useActionWorkflow } from "./useCatalogActions";
import {
  useMounted,
  useOperationGeneration,
  usePollTimerRegistry,
} from "./useCatalogLifecycle";

const nativeMocks = vi.hoisted(() => ({
  act: vi.fn(),
  action: vi.fn(),
}));

vi.mock("../native-bridge/native", () => ({ native: nativeMocks }));

function availableApp(
  id = "firefox",
  overrides: Partial<AvailableApp> = {},
): AvailableApp {
  return {
    id,
    name: id,
    description: null,
    publisher: null,
    source: "winget",
    packageIdentifier: null,
    releasedVersionId: "release",
    releasedVersionLabel: "128",
    installedVersionId: null,
    installedVersionLabel: null,
    installState: "available",
    activeActionId: null,
    activeActionState: null,
    hasIcon: false,
    ...overrides,
  };
}

function restartedApplication() {
  return availableApp("firefox", {
    activeActionId: "restart-42",
    activeActionState: "queued",
    installState: "available",
  });
}

function expectTerminalReload(
  workflow: {
    actions: ReadonlyMap<string, AppAction>;
    polling: ReadonlyMap<string, unknown>;
  },
  load: ReturnType<typeof vi.fn>,
) {
  expect(workflow.actions.get("firefox")?.state).toBe("succeeded");
  expect(workflow.polling.has("firefox")).toBe(false);
  expect(load).toHaveBeenCalledTimes(1);
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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function useActionHarness(load = vi.fn().mockResolvedValue(undefined)) {
  const mounted = useMounted();
  const pollTimers = usePollTimerRegistry();
  const operation = useOperationGeneration(pollTimers.clear);
  const workflow = useActionWorkflow(
    "en",
    mounted,
    operation.generation,
    load,
    pollTimers,
  );
  return { load, operation, workflow };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useActionWorkflow", () => {
  it("hydrates a restarted active action once and resumes polling it", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(undefined);
    vi.mocked(native.action)
      .mockResolvedValueOnce(appAction("queued", { id: "restart-42" }))
      .mockResolvedValueOnce(appAction("succeeded", { id: "restart-42" }));
    const { result } = renderHook(() => useActionHarness(load));
    const application = restartedApplication();

    await act(async () => {
      await result.current.workflow.hydrateActions([application]);
      await result.current.workflow.hydrateActions([application]);
    });

    expect(native.action).toHaveBeenCalledTimes(1);
    expect(result.current.workflow.actions.get("firefox")?.id).toBe(
      "restart-42",
    );
    expect(result.current.workflow.polling.get("firefox")).toBe("polling");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(native.action).toHaveBeenCalledTimes(2);
    expectTerminalReload(result.current.workflow, load);
  });

  it("ignores stale and mismatched hydration results", async () => {
    vi.useFakeTimers();
    const stale = deferred<AppAction>();
    vi.mocked(native.action)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(
        appAction("queued", { appId: "other-app", id: "other-action" }),
      );
    const { result } = renderHook(useActionHarness);
    const application = restartedApplication();

    const hydration = result.current.workflow.hydrateActions([application]);
    act(() => {
      result.current.workflow.resetActions();
    });
    stale.resolve(appAction("queued", { id: "restart-42" }));
    await act(async () => {
      await hydration;
      await result.current.workflow.hydrateActions([application]);
    });

    expect(native.action).toHaveBeenCalledTimes(2);
    expect(result.current.workflow.actions).toEqual(new Map());
    expect(result.current.workflow.polling).toEqual(new Map());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient hydration failure on a later catalog refresh", async () => {
    vi.useFakeTimers();
    vi.mocked(native.action)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(appAction("queued", { id: "restart-42" }));
    const { result } = renderHook(useActionHarness);
    const application = restartedApplication();

    await act(async () => {
      await result.current.workflow.hydrateActions([application]);
      await result.current.workflow.hydrateActions([application]);
    });

    expect(native.action).toHaveBeenCalledTimes(2);
    expect(result.current.workflow.actions.get("firefox")?.id).toBe(
      "restart-42",
    );
    expect(result.current.workflow.polling.get("firefox")).toBe("polling");
  });

  it("pauses after a transient poll failure and resumes to a terminal result", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(undefined);
    vi.mocked(native.act).mockResolvedValue(appAction("queued"));
    vi.mocked(native.action)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(appAction("succeeded"));
    const { result } = renderHook(() => useActionHarness(load));

    await act(async () => {
      await result.current.workflow.startAction(availableApp());
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.workflow.polling.get("firefox")).toBe("paused");

    act(() => {
      result.current.workflow.resumeAction("firefox");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expectTerminalReload(result.current.workflow, load);
  });

  it("reloads the catalog after a terminal hydrated result", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    vi.mocked(native.action).mockResolvedValue(appAction("succeeded"));
    const { result } = renderHook(() => useActionHarness(load));

    await act(async () => {
      await result.current.workflow.hydrateActions([
        availableApp("firefox", {
          activeActionId: "action-42",
          activeActionState: "succeeded",
          installState: "available",
        }),
      ]);
    });

    expect(result.current.workflow.actions.get("firefox")?.state).toBe(
      "succeeded",
    );
    expect(result.current.workflow.polling.has("firefox")).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending poll before its native status request", async () => {
    vi.useFakeTimers();
    vi.mocked(native.act).mockResolvedValue(appAction("queued"));
    const { result } = renderHook(useActionHarness);

    await act(async () => {
      await result.current.workflow.startAction(availableApp());
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      result.current.operation.cancel();
    });
    expect(result.current.operation.generation.current).toBe(1);
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
    const { result } = renderHook(useActionHarness);
    let firstStart!: Promise<void>;
    let secondStart!: Promise<void>;

    act(() => {
      firstStart = result.current.workflow.startAction(availableApp("alpha"));
      secondStart = result.current.workflow.startAction(availableApp("beta"));
      void result.current.workflow.startAction(availableApp("alpha"));
    });

    expect(native.act).toHaveBeenCalledTimes(2);
    expect(native.act).toHaveBeenNthCalledWith(1, "alpha");
    expect(native.act).toHaveBeenNthCalledWith(2, "beta");
    expect(result.current.workflow.busyApps).toEqual(
      new Set(["alpha", "beta"]),
    );

    await act(async () => {
      first.resolve(
        appAction("failed", { id: "alpha-action", appId: "alpha" }),
      );
      await firstStart;
    });
    expect(result.current.workflow.busyApps).toEqual(new Set(["beta"]));
    expect(result.current.workflow.busy).toBe("beta");

    await act(async () => {
      second.resolve(appAction("failed", { id: "beta-action", appId: "beta" }));
      await secondStart;
    });
    expect(result.current.workflow.busyApps).toEqual(new Set());
  });

  it("does not let a stale completion clear a newer generation start", async () => {
    const stale = deferred<AppAction>();
    const current = deferred<AppAction>();
    vi.mocked(native.act)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const { result } = renderHook(useActionHarness);
    let staleStart!: Promise<void>;
    let currentStart!: Promise<void>;

    act(() => {
      staleStart = result.current.workflow.startAction(availableApp("alpha"));
    });
    act(() => {
      result.current.workflow.resetActions();
      currentStart = result.current.workflow.startAction(availableApp("alpha"));
    });

    await act(async () => {
      stale.resolve(
        appAction("failed", { id: "stale-action", appId: "alpha" }),
      );
      await staleStart;
    });
    expect(result.current.workflow.busyApps).toEqual(new Set(["alpha"]));
    expect(result.current.workflow.actions.has("alpha")).toBe(false);

    await act(async () => {
      current.resolve(
        appAction("failed", { id: "current-action", appId: "alpha" }),
      );
      await currentStart;
    });
    expect(result.current.workflow.busyApps).toEqual(new Set());
    expect(result.current.workflow.actions.get("alpha")?.id).toBe(
      "current-action",
    );
    expect(native.act).toHaveBeenCalledTimes(2);
  });
});
