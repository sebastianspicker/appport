import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogPhase, CatalogSetters } from "./catalogTypes";
import type { AvailableApp, ConnectOutcome, NativeBootstrap } from "./models";
import { native } from "./native";
import {
  appAction,
  availableApp,
  resetNativeMockDefaults,
} from "./testFixtures";
import {
  useMounted,
  useOperationGeneration,
  usePollTimerRegistry,
} from "./useAppCatalog";
import { useClientOperations } from "./useClientOperations";

vi.mock("./native", async () => {
  const { createNativeMock: createMock } = await import("./testFixtures");
  return { native: createMock() };
});

function useOperationsHarness() {
  const mounted = useMounted();
  const pollTimers = usePollTimerRegistry();
  const operation = useOperationGeneration(pollTimers.clear);
  const [, setApps] = useState<AvailableApp[]>([]);
  const [, setBootstrap] = useState<NativeBootstrap>();
  const [, setPhase] = useState<CatalogPhase>("ready");
  const setters = { setApps, setBootstrap, setPhase } as CatalogSetters;
  const load = vi.fn().mockResolvedValue(undefined);
  const client = useClientOperations(
    "en",
    mounted,
    operation.generation,
    load,
    pollTimers,
    operation.cancel,
    setters,
  );
  return { client, load };
}

beforeEach(() => {
  resetNativeMockDefaults(vi.mocked(native));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useClientOperations credential replacement", () => {
  it.each<[string, () => Promise<ConnectOutcome>]>([
    ["successful", () => Promise.resolve({ backgroundCheckRegistered: true })],
    ["failed", () => Promise.reject(new Error("connect failed"))],
  ])(
    "clears an active old action before a %s replacement",
    async (_, connect) => {
      vi.useFakeTimers();
      vi.mocked(native.act).mockResolvedValue(appAction("queued"));
      vi.mocked(native.connect).mockImplementation(connect);
      const { result } = renderHook(useOperationsHarness);

      await act(async () => {
        await result.current.client.actions.startAction(
          availableApp("firefox"),
        );
      });
      expect(result.current.client.actions.actions.get("firefox")?.id).toBe(
        "action-42",
      );
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await act(async () => {
        await result.current.client.connect.connect("new-user", "new-token");
      });

      expect(result.current.client.actions.actions).toEqual(new Map());
      expect(result.current.client.actions.actionFailures).toEqual(new Map());
      expect(result.current.client.actions.busy).toBeUndefined();
      expect(result.current.client.actions.polling).toEqual(new Map());
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
