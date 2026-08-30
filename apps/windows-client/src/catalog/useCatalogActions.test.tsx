import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
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
    const application = availableApp("firefox", {
      activeActionId: "restart-42",
      activeActionState: "queued",
      installState: "available",
    });

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
    expect(result.current.workflow.actions.get("firefox")?.state).toBe(
      "succeeded",
    );
    expect(result.current.workflow.polling.has("firefox")).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
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
    const application = availableApp("firefox", {
      activeActionId: "restart-42",
      activeActionState: "queued",
      installState: "available",
    });

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
    const application = availableApp("firefox", {
      activeActionId: "restart-42",
      activeActionState: "queued",
      installState: "available",
    });

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

    expect(result.current.workflow.actions.get("firefox")?.state).toBe(
      "succeeded",
    );
    expect(result.current.workflow.polling.has("firefox")).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
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
});
