import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useActionHydrator } from "./useActionHydrator";
import { copyFor, type Locale } from "../i18n/copy";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import { problemFor } from "../native-bridge/problem";
import {
  completeTerminalAction,
  isTerminalActionState,
  saveAction,
  withoutKey,
} from "./actionState";
import type { PollingState } from "./model";
import type { PollTimerRegistry } from "./usePollTimerRegistry";

const maxPollAttempts = 150;

type IsCurrentAction = (
  appId: string,
  actionGeneration: number,
  sessionGeneration: number,
) => boolean;

type ActionGenerations = {
  actionGenerations: MutableRefObject<Map<string, number>>;
  generation: MutableRefObject<number>;
};

type ActionStateSetters = {
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>;
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>;
};

type ActivePollContext = ActionStateSetters & {
  isCurrent: IsCurrentAction;
  load: () => Promise<void>;
  pollTimers: PollTimerRegistry;
};

type ActionPollerContext = ActionGenerations &
  ActionStateSetters & {
    load: () => Promise<void>;
    mounted: MutableRefObject<boolean>;
    pollTimers: PollTimerRegistry;
  };

type ActionStartContext = ActionGenerations &
  ActionStateSetters & {
    isCurrent: IsCurrentAction;
    locale: Locale;
    pendingStarts: MutableRefObject<Map<string, symbol>>;
    poll: (
      action: AppAction,
      actionGeneration: number,
      sessionGeneration: number,
    ) => Promise<void>;
    pollTimers: PollTimerRegistry;
    setActionFailures: Dispatch<SetStateAction<Map<string, string>>>;
    setBusyApps: Dispatch<SetStateAction<Set<string>>>;
  };

type ActionWorkflowOptions = {
  generation: MutableRefObject<number>;
  load: () => Promise<void>;
  locale: Locale;
  mounted: MutableRefObject<boolean>;
  pollTimers: PollTimerRegistry;
};

function pauseIfCurrent(
  action: AppAction,
  current: boolean,
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>,
) {
  if (current)
    setPolling((existing) => new Map(existing).set(action.appId, "paused"));
}

function nextActionGeneration(
  appId: string,
  { actionGenerations, generation }: ActionGenerations,
) {
  const actionGeneration = (actionGenerations.current.get(appId) ?? 0) + 1;
  actionGenerations.current.set(appId, actionGeneration);
  return { actionGeneration, sessionGeneration: generation.current };
}

async function pollNextAction(
  context: ActivePollContext,
  initialAction: AppAction,
  currentAction: AppAction,
  actionGeneration: number,
  sessionGeneration: number,
) {
  await context.pollTimers.schedule(initialAction.appId);
  if (
    !context.isCurrent(initialAction.appId, actionGeneration, sessionGeneration)
  )
    return;
  try {
    const next = await native.action(currentAction.id);
    if (
      !context.isCurrent(
        initialAction.appId,
        actionGeneration,
        sessionGeneration,
      )
    )
      return;
    saveAction(next, context.setActions);
    return next;
  } catch {
    pauseIfCurrent(
      initialAction,
      context.isCurrent(
        initialAction.appId,
        actionGeneration,
        sessionGeneration,
      ),
      context.setPolling,
    );
  }
}

async function pollAction(
  context: ActivePollContext,
  action: AppAction,
  actionGeneration: number,
  sessionGeneration: number,
) {
  let current = action;
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    if (!context.isCurrent(action.appId, actionGeneration, sessionGeneration))
      return;
    if (isTerminalActionState(current.state)) {
      await completeTerminalAction(
        current,
        context.pollTimers,
        context.setPolling,
        context.load,
      );
      return;
    }
    const next = await pollNextAction(
      context,
      action,
      current,
      actionGeneration,
      sessionGeneration,
    );
    if (!next) return;
    current = next;
  }
  pauseIfCurrent(
    action,
    context.isCurrent(action.appId, actionGeneration, sessionGeneration),
    context.setPolling,
  );
}

function useActionPoller({
  actionGenerations,
  generation,
  load,
  mounted,
  pollTimers,
  setActions,
  setPolling,
}: ActionPollerContext) {
  const isCurrent = useCallback(
    (appId: string, actionGeneration: number, sessionGeneration: number) =>
      mounted.current &&
      generation.current === sessionGeneration &&
      actionGenerations.current.get(appId) === actionGeneration,
    [actionGenerations, generation, mounted],
  );

  const poll = useCallback(
    async (
      action: AppAction,
      actionGeneration: number,
      sessionGeneration: number,
    ) =>
      pollAction(
        { isCurrent, load, pollTimers, setActions, setPolling },
        action,
        actionGeneration,
        sessionGeneration,
      ),
    [isCurrent, load, pollTimers, setActions, setPolling],
  );

  const beginPolling = useCallback(
    (action: AppAction) => {
      pollTimers.clear(action.appId);
      const { actionGeneration, sessionGeneration } = nextActionGeneration(
        action.appId,
        { actionGenerations, generation },
      );
      setPolling((existing) => new Map(existing).set(action.appId, "polling"));
      void poll(action, actionGeneration, sessionGeneration);
    },
    [actionGenerations, generation, poll, pollTimers, setPolling],
  );

  return { beginPolling, isCurrent, poll };
}

function useActionStarter({
  actionGenerations,
  generation,
  isCurrent,
  locale,
  poll,
  pollTimers,
  pendingStarts,
  setActionFailures,
  setActions,
  setBusyApps,
  setPolling,
}: ActionStartContext) {
  return useCallback(
    async (application: AvailableApp) => {
      if (pendingStarts.current.has(application.id)) return;
      const pendingToken = Symbol(application.id);
      pendingStarts.current.set(application.id, pendingToken);
      setBusyApps(new Set(pendingStarts.current.keys()));
      pollTimers.clear(application.id);
      const { actionGeneration, sessionGeneration } = nextActionGeneration(
        application.id,
        { actionGenerations, generation },
      );
      setActionFailures((existing) => withoutKey(existing, application.id));
      try {
        const started = await native.act(application.id);
        if (!isCurrent(application.id, actionGeneration, sessionGeneration))
          return;
        saveAction(started, setActions);
        setPolling((existing) =>
          new Map(existing).set(application.id, "polling"),
        );
        void poll(started, actionGeneration, sessionGeneration);
      } catch (error) {
        if (!isCurrent(application.id, actionGeneration, sessionGeneration))
          return;
        setActionFailures((existing) =>
          new Map(existing).set(
            application.id,
            problemFor(error) === "unknown"
              ? copyFor(locale).actionStartFailed[1]
              : copyFor(locale).actionStartFailed[0],
          ),
        );
      } finally {
        if (pendingStarts.current.get(application.id) === pendingToken) {
          pendingStarts.current.delete(application.id);
          setBusyApps(new Set(pendingStarts.current.keys()));
        }
      }
    },
    [
      actionGenerations,
      generation,
      isCurrent,
      locale,
      poll,
      pollTimers,
      pendingStarts,
      setActionFailures,
      setActions,
      setBusyApps,
      setPolling,
    ],
  );
}

function useResumeAction(
  actions: ReadonlyMap<string, AppAction>,
  beginPolling: (action: AppAction) => void,
) {
  return useCallback(
    (appId: string) => {
      const action = actions.get(appId);
      if (!action || isTerminalActionState(action.state)) return;
      beginPolling(action);
    },
    [actions, beginPolling],
  );
}

/** Owns per-application action state, starts, polling, and hydration of restarted actions. */
export function useActionWorkflow({
  generation,
  load,
  locale,
  mounted,
  pollTimers,
}: ActionWorkflowOptions) {
  const [actions, setActions] = useState<Map<string, AppAction>>(
    () => new Map(),
  );
  const [actionFailures, setActionFailures] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [busyApps, setBusyApps] = useState<Set<string>>(() => new Set());
  const [polling, setPolling] = useState<Map<string, PollingState>>(
    () => new Map(),
  );
  const actionGenerations = useRef(new Map<string, number>());
  const pendingStarts = useRef(new Map<string, symbol>());
  const { beginPolling, isCurrent, poll } = useActionPoller({
    actionGenerations,
    generation,
    load,
    mounted,
    pollTimers,
    setActions,
    setPolling,
  });
  const hydrationContext = useMemo(
    () => ({
      actionGenerations,
      beginPolling,
      generation,
      isCurrent,
      load,
      mounted,
      pollTimers,
      setActions,
      setPolling,
    }),
    [
      actionGenerations,
      beginPolling,
      generation,
      isCurrent,
      load,
      mounted,
      pollTimers,
      setActions,
      setPolling,
    ],
  );
  const { hydrateActions, resetHydration } =
    useActionHydrator(hydrationContext);
  const startAction = useActionStarter({
    actionGenerations,
    generation,
    isCurrent,
    locale,
    poll,
    pollTimers,
    pendingStarts,
    setActionFailures,
    setActions,
    setBusyApps,
    setPolling,
  });
  const resumeAction = useResumeAction(actions, beginPolling);
  const resetActions = useCallback(() => {
    pollTimers.clear();
    for (const [appId, value] of actionGenerations.current)
      actionGenerations.current.set(appId, value + 1);
    pendingStarts.current.clear();
    resetHydration();
    setActionFailures(new Map());
    setActions(new Map());
    setBusyApps(new Set());
    setPolling(new Map());
  }, [actionGenerations, pendingStarts, pollTimers, resetHydration]);

  return {
    actionFailures,
    actions,
    busyApps,
    hydrateActions,
    polling,
    resetActions,
    resumeAction,
    startAction,
  };
}
