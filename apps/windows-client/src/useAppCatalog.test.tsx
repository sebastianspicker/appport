import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableApp, ClientProblem, NativeBootstrap } from "./models";
import { native } from "./native";
import {
  appAction,
  availableApp,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
} from "./testFixtures";
import {
  useActionWorkflow,
  useCatalogLoading,
  useMounted,
  useOperationGeneration,
  usePollTimerRegistry,
} from "./useAppCatalog";

vi.mock("./native", async () => {
  const { createNativeMock: createMock } = await import("./testFixtures");
  return { native: createMock() };
});

function useCatalogHarness() {
  const mounted = useMounted();
  const generation = useRef(0);
  const resolveView = useCallback(() => native.initialView(), []);
  const [apps, setApps] = useState<AvailableApp[]>([]);
  const [currentBootstrap, setBootstrap] = useState<NativeBootstrap>();
  const [phase, setPhase] = useState<"ready" | ClientProblem>("loading");
  const load = useCatalogLoading(undefined, resolveView, mounted, generation, {
    setApps,
    setBootstrap,
    setPhase,
  });
  return { apps, bootstrap: currentBootstrap, load, phase };
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

beforeEach(() => {
  resetNativeMockDefaults(vi.mocked(native));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCatalogLoading", () => {
  it("resolves the initial view before loading when sign-in finishes early", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    const { result } = renderHook(useCatalogHarness);

    await act(async () => {
      await result.current.load();
    });

    expect(native.bootstrap).toHaveBeenCalledTimes(1);
    expect(native.apps).toHaveBeenCalledTimes(1);
    expect(native.apps).toHaveBeenCalledWith("updates");
  });

  it("keeps the latest catalog request when an older view resolves last", async () => {
    const olderBootstrap = deferred<NativeBootstrap>();
    const newerBootstrap = deferred<NativeBootstrap>();
    const olderApps = deferred<AvailableApp[]>();
    const newerApps = deferred<AvailableApp[]>();
    vi.mocked(native.bootstrap)
      .mockReturnValueOnce(olderBootstrap.promise)
      .mockReturnValueOnce(newerBootstrap.promise);
    vi.mocked(native.apps)
      .mockReturnValueOnce(olderApps.promise)
      .mockReturnValueOnce(newerApps.promise);
    const { result } = renderHook(useCatalogHarness);

    const older = result.current.load("apps");
    const newer = result.current.load("updates");
    newerBootstrap.resolve(nativeBootstrap());
    newerApps.resolve([availableApp("update", "Update result")]);
    await act(async () => {
      await newer;
    });

    olderBootstrap.resolve(nativeBootstrap());
    olderApps.resolve([availableApp("available", "Available result")]);
    await act(async () => {
      await older;
    });

    expect(result.current.apps).toEqual([
      availableApp("update", "Update result"),
    ]);
    expect(result.current.phase).toBe("ready");
  });
});

describe("useActionWorkflow", () => {
  it("hydrates a restarted active action once and resumes polling it", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(undefined);
    vi.mocked(native.action)
      .mockResolvedValueOnce(appAction("queued", { id: "restart-42" }))
      .mockResolvedValueOnce(appAction("succeeded", { id: "restart-42" }));
    const { result } = renderHook(() => useActionHarness(load));
    const application = availableApp("firefox", "Firefox", {
      activeActionId: "restart-42",
      activeActionState: "queued",
      installState: "action_active",
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

  it("rejects a mismatched hydrated action without saving or polling it", async () => {
    vi.useFakeTimers();
    vi.mocked(native.action).mockResolvedValue(
      appAction("queued", { appId: "other-app", id: "other-action" }),
    );
    const { result } = renderHook(useActionHarness);

    await act(async () => {
      await result.current.workflow.hydrateActions([
        availableApp("firefox", "Firefox", {
          activeActionId: "restart-42",
          activeActionState: "queued",
          installState: "action_active",
        }),
      ]);
    });

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
    const application = availableApp("firefox", "Firefox", {
      activeActionId: "restart-42",
      activeActionState: "queued",
      installState: "action_active",
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

  it("pauses after a transient poll failure, then resumes to a terminal result", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(undefined);
    vi.mocked(native.act).mockResolvedValue(appAction("queued"));
    vi.mocked(native.action)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(appAction("succeeded"));
    const { result } = renderHook(() => useActionHarness(load));

    await act(async () => {
      await result.current.workflow.startAction(availableApp("firefox"));
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.workflow.actions.get("firefox")?.state).toBe(
      "queued",
    );
    expect(result.current.workflow.polling.get("firefox")).toBe("paused");
    expect(result.current.workflow.actions.get("firefox")?.state).not.toBe(
      "unknown",
    );

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

  it("cancels a pending poll before its native status request", async () => {
    vi.useFakeTimers();
    vi.mocked(native.act).mockResolvedValue(appAction("queued"));
    const { result } = renderHook(useActionHarness);

    await act(async () => {
      await result.current.workflow.startAction(availableApp("firefox"));
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
