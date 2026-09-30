import type { Dispatch, SetStateAction } from "react";
import type { AppAction } from "../native-bridge/types";
import type { PollingState } from "./model";
import type { PollTimerRegistry } from "./usePollTimerRegistry";

const terminalStates = new Set(["succeeded", "failed", "cancelled", "unknown"]);

export function isTerminalActionState(state: string) {
  return terminalStates.has(state);
}

export function withoutKey<Value>(
  entries: ReadonlyMap<string, Value>,
  key: string,
) {
  const next = new Map(entries);
  next.delete(key);
  return next;
}

export function saveAction(
  action: AppAction,
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>,
) {
  setActions((existing) => new Map(existing).set(action.appId, action));
}

export async function completeTerminalAction(
  action: AppAction,
  pollTimers: PollTimerRegistry,
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>,
  load: () => Promise<void>,
) {
  pollTimers.clear(action.appId);
  setPolling((existing) => withoutKey(existing, action.appId));
  if (action.state === "succeeded") await load();
}
