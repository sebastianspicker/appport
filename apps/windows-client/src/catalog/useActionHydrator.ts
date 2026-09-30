import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import {
  completeTerminalAction,
  isTerminalActionState,
  saveAction,
} from "./actionState";
import type { PollingState } from "./model";
import type { PollTimerRegistry } from "./usePollTimerRegistry";
import { HydrationPool } from "./hydrationPool";

type HydrationMarker = {
  actionId: string;
  sessionGeneration: number;
};

type HydrationAttempt = HydrationMarker & {
  actionGeneration: number;
};

type HydrationContext = {
  actionGenerations: MutableRefObject<Map<string, number>>;
  beginPolling: (action: AppAction) => void;
  isCurrent: (
    appId: string,
    actionGeneration: number,
    sessionGeneration: number,
  ) => boolean;
  generation: MutableRefObject<number>;
  load: () => Promise<void>;
  mounted: MutableRefObject<boolean>;
  pollTimers: PollTimerRegistry;
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>;
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>;
};

function isHydrated(
  hydrated: ReadonlyMap<string, HydrationMarker>,
  appId: string,
  marker: HydrationMarker,
) {
  const previous = hydrated.get(appId);
  return (
    previous?.actionId === marker.actionId &&
    previous.sessionGeneration === marker.sessionGeneration
  );
}

function beginHydrationAttempt(
  context: HydrationContext,
  hydrated: Map<string, HydrationMarker>,
  application: AvailableApp,
) {
  const actionId = application.activeActionId;
  const sessionGeneration = context.generation.current;
  if (!actionId) return;
  const marker = { actionId, sessionGeneration };
  if (isHydrated(hydrated, application.id, marker)) return;
  hydrated.set(application.id, marker);
  const actionGeneration =
    (context.actionGenerations.current.get(application.id) ?? 0) + 1;
  context.actionGenerations.current.set(application.id, actionGeneration);
  return { ...marker, actionGeneration };
}

function isCurrentHydrationResult(
  context: HydrationContext,
  application: AvailableApp,
  attempt: HydrationAttempt,
  action: AppAction,
) {
  return (
    context.isCurrent(
      application.id,
      attempt.actionGeneration,
      attempt.sessionGeneration,
    ) &&
    action.id === attempt.actionId &&
    action.appId === application.id
  );
}

function discardFailedHydration(
  context: HydrationContext,
  hydrated: Map<string, HydrationMarker>,
  application: AvailableApp,
  attempt: HydrationAttempt,
) {
  const stillCurrent =
    context.mounted.current &&
    context.generation.current === attempt.sessionGeneration &&
    context.actionGenerations.current.get(application.id) ===
      attempt.actionGeneration;
  if (stillCurrent) hydrated.delete(application.id);
}

async function applyHydratedAction(
  context: HydrationContext,
  action: AppAction,
) {
  saveAction(action, context.setActions);
  if (!isTerminalActionState(action.state)) {
    context.beginPolling(action);
    return;
  }
  await completeTerminalAction(
    action,
    context.pollTimers,
    context.setPolling,
    context.load,
  );
}

async function hydrateAction(
  context: HydrationContext,
  hydrated: Map<string, HydrationMarker>,
  application: AvailableApp,
  pool: HydrationPool,
) {
  const attempt = beginHydrationAttempt(context, hydrated, application);
  if (!attempt) return;
  try {
    const action = await pool.load(attempt.actionId, () =>
      context.isCurrent(
        application.id,
        attempt.actionGeneration,
        attempt.sessionGeneration,
      ),
    );
    if (!action) return;
    if (!isCurrentHydrationResult(context, application, attempt, action))
      return;
    await applyHydratedAction(context, action);
  } catch {
    discardFailedHydration(context, hydrated, application, attempt);
  }
}

export function useActionHydrator(context: HydrationContext) {
  const pool = useRef(new HydrationPool());
  useEffect(() => () => pool.current.clear(), []);
  const hydrated = useRef(new Map<string, HydrationMarker>());
  const hydrateActions = useCallback(
    async (applications: AvailableApp[]) => {
      await Promise.all(
        applications.map((application) =>
          hydrateAction(context, hydrated.current, application, pool.current),
        ),
      );
    },
    [context],
  );
  const resetHydration = useCallback(() => {
    hydrated.current.clear();
    pool.current.clear();
  }, []);
  return { hydrateActions, resetHydration };
}
