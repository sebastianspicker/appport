import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppAction,
  AvailableApp,
  ClientProblem,
  NativeBootstrap,
} from "./models";
import { native } from "./native";
import {
  useActionWorkflow,
  useCatalogLoading,
  useMounted,
  useOperationGeneration,
  usePollTimerRegistry,
} from "./useAppCatalog";

vi.mock("./native", () => ({
  native: {
    initialView: vi.fn().mockResolvedValue("apps"),
    connect: vi.fn(),
    bootstrap: vi.fn(),
    apps: vi.fn(),
    act: vi.fn(),
    action: vi.fn(),
    icon: vi.fn().mockResolvedValue(null),
    signOut: vi.fn(),
    openRelutionPortal: vi.fn().mockResolvedValue(undefined),
  },
}));

const bootstrap: NativeBootstrap = {
  user: { displayName: "Ada" },
  device: { name: "PC", status: "COMPLIANT", lastSeenAt: null },
  updates: { count: 0, keys: [] },
  writesEnabled: false,
};

function application(id: string, name = id): AvailableApp {
  return {
    id,
    name,
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
  };
}

function action(state: AppAction["state"]): AppAction {
  return {
    id: "action-42",
    appId: "firefox",
    deviceId: "device",
    intent: "install",
    state,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function useCatalogHarness() {
  const mounted = useMounted();
  const generation = useRef(0);
  const [apps, setApps] = useState<AvailableApp[]>([]);
  const [currentBootstrap, setBootstrap] = useState<NativeBootstrap>();
  const [phase, setPhase] = useState<"ready" | ClientProblem>("loading");
  const load = useCatalogLoading(undefined, mounted, generation, {
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
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCatalogLoading", () => {
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
    newerBootstrap.resolve(bootstrap);
    newerApps.resolve([application("update", "Update result")]);
    await act(async () => {
      await newer;
    });

    olderBootstrap.resolve(bootstrap);
    olderApps.resolve([application("available", "Available result")]);
    await act(async () => {
      await older;
    });

    expect(result.current.apps).toEqual([
      application("update", "Update result"),
    ]);
    expect(result.current.phase).toBe("ready");
  });
});

describe("useActionWorkflow", () => {
  it("pauses after a transient poll failure, then resumes to a terminal result", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(undefined);
    vi.mocked(native.act).mockResolvedValue(action("queued"));
    vi.mocked(native.action)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(action("succeeded"));
    const { result } = renderHook(() => useActionHarness(load));

    await act(async () => {
      await result.current.workflow.startAction(application("firefox"));
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
    vi.mocked(native.act).mockResolvedValue(action("queued"));
    const { result } = renderHook(useActionHarness);

    await act(async () => {
      await result.current.workflow.startAction(application("firefox"));
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
