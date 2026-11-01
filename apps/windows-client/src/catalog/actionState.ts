import type { Dispatch, SetStateAction } from "react";
import type { ActionState, AppAction } from "../native-bridge/types";
import type { PollingState } from "./model";
import type { PollTimerRegistry } from "./usePollTimerRegistry";

const terminalStates: ReadonlySet<ActionState> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

export function isTerminalActionState(state: ActionState) {
  return terminalStates.has(state);
}

/** Failed and cancelled requests may be sent again. */
export function isRetryable(state: ActionState | null | undefined) {
  return state === "failed" || state === "cancelled";
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
  // Success and a released `unknown` both change what the refreshed catalog allows.
  if (action.state === "succeeded" || action.errorCode === "UNKNOWN_RELEASED")
    await load();
}
