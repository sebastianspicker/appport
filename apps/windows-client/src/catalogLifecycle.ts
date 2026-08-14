import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resetIconSession } from "./AppIcon";
import { native } from "./native";
import type { PollTimerRegistry, View } from "./catalogTypes";

type PollTimer = { resolve: () => void; timerId: number };

const pollIntervalMs = 2_000;

export function useViewSelection() {
  const [view, setView] = useState<View>();
  useEffect(() => {
    void native
      .initialView()
      .then(setView)
      .catch(() => {
        setView("apps");
      });
  }, []);
  return [view, setView] as const;
}

export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

export function usePollTimerRegistry(): PollTimerRegistry {
  const timers = useRef(new Map<string, PollTimer>());
  const clear = useCallback((appId?: string) => {
    const entries = appId
      ? [[appId, timers.current.get(appId)] as const]
      : [...timers.current.entries()];
    for (const [key, timer] of entries) {
      if (!timer) continue;
      window.clearTimeout(timer.timerId);
      timers.current.delete(key);
      timer.resolve();
    }
  }, []);
  const schedule = useCallback(
    (appId: string) =>
      new Promise<void>((resolve) => {
        clear(appId);
        const timerId = window.setTimeout(() => {
          timers.current.delete(appId);
          resolve();
        }, pollIntervalMs);
        timers.current.set(appId, { resolve, timerId });
      }),
    [clear],
  );
  useEffect(() => clear, [clear]);
  return useMemo(() => ({ clear, schedule }), [clear, schedule]);
}

/** A session generation invalidates transient work without subscribing the UI to it. */
export function useOperationGeneration(clearPollTimers: () => void) {
  const generation = useRef(0);
  const [iconSession, setIconSession] = useState(0);
  const cancel = useCallback(() => {
    generation.current += 1;
    clearPollTimers();
    resetIconSession();
    setIconSession((current) => current + 1);
  }, [clearPollTimers]);
  useEffect(() => cancel, [cancel]);
  return { cancel, generation, iconSession };
}
