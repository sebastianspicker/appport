import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import type {
  ActionGenerationContext,
  PollTimerRegistry,
  PollingState,
} from "./types";
import { HydrationPool } from "./hydrationPool";

type HydrationMarker = {
  actionId: string;
  sessionGeneration: number;
};

type HydrationAttempt = HydrationMarker & {
  actionGeneration: number;
};

export type HydrationContext = ActionGenerationContext & {
  beginPolling: (action: AppAction) => void;
  isCurrent: (
    appId: string,
    actionGeneration: number,
    sessionGeneration: number,
  ) => boolean;
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

async function hydrateAction(
  context: HydrationContext,
  hydrated: Map<string, HydrationMarker>,
  application: AvailableApp,
  pool: HydrationPool,
  apply: (context: HydrationContext, action: AppAction) => Promise<void>,
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
    await apply(context, action);
  } catch {
    discardFailedHydration(context, hydrated, application, attempt);
  }
}

export function useActionHydrator(
  context: HydrationContext,
  apply: (context: HydrationContext, action: AppAction) => Promise<void>,
) {
  const pool = useRef(new HydrationPool());
  useEffect(() => () => pool.current.clear(), []);
  const hydrated = useRef(new Map<string, HydrationMarker>());
  const hydrateActions = useCallback(
    async (applications: AvailableApp[]) => {
      await Promise.all(
        applications.map((application) =>
          hydrateAction(
            context,
            hydrated.current,
            application,
            pool.current,
            apply,
          ),
        ),
      );
    },
    [context, apply],
  );
  const resetHydration = useCallback(() => {
    hydrated.current.clear();
    pool.current.clear();
  }, []);
  return { hydrateActions, resetHydration };
}
