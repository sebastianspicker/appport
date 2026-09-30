import { useCallback, useEffect, useMemo, useRef } from "react";

type PollTimer = { resolve: () => void; timerId: number };

export type PollTimerRegistry = {
  clear: (appId?: string) => void;
  schedule: (appId: string) => Promise<void>;
};

const pollIntervalMs = 2_000;

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
