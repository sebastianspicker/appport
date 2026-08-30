import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import { problemFor } from "../native-bridge/problem";
import {
  withoutKey,
  type ActionGenerationContext,
  type ActionPollingContext,
  type ActionStartContext,
  type PollingState,
  type PollTimerRegistry,
} from "./types";

const terminalStates = new Set(["succeeded", "failed", "cancelled", "unknown"]);
const maxPollAttempts = 150;

type ActivePollContext = {
  isCurrent: (
    appId: string,
    actionGeneration: number,
    sessionGeneration: number,
  ) => boolean;
  load: () => Promise<void>;
  pollTimers: PollTimerRegistry;
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>;
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>;
};

type HydrationMarker = {
  actionId: string;
  sessionGeneration: number;
};

type HydrationAttempt = HydrationMarker & {
  actionGeneration: number;
};

type HydrationContext = ActionGenerationContext & {
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

function saveAction(
  action: AppAction,
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>,
) {
  setActions((existing) => new Map(existing).set(action.appId, action));
}

async function completeTerminalAction(
  action: AppAction,
  pollTimers: PollTimerRegistry,
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>,
  load: () => Promise<void>,
) {
  pollTimers.clear(action.appId);
  setPolling((existing) => withoutKey(existing, action.appId));
  if (action.state === "succeeded") await load();
}

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
  { actionGenerations, generation }: ActionGenerationContext,
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
    if (terminalStates.has(current.state)) {
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
}: ActionPollingContext) {
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
  setActionFailures,
  setActions,
  setBusy,
  setPolling,
}: ActionStartContext) {
  return useCallback(
    async (application: AvailableApp) => {
      pollTimers.clear(application.id);
      const { actionGeneration, sessionGeneration } = nextActionGeneration(
        application.id,
        { actionGenerations, generation },
      );
      setBusy(application.id);
      setActionFailures((existing) => withoutKey(existing, application.id));
      try {
        const started = await native.act(application.id);
        if (!isCurrent(application.id, actionGeneration, sessionGeneration))
          return;
        saveAction(started, setActions);
        setBusy((current) =>
          current === application.id ? undefined : current,
        );
        setPolling((existing) =>
          new Map(existing).set(application.id, "polling"),
        );
        void poll(started, actionGeneration, sessionGeneration);
      } catch (error) {
        if (!isCurrent(application.id, actionGeneration, sessionGeneration))
          return;
        setBusy((current) =>
          current === application.id ? undefined : current,
        );
        setActionFailures((existing) =>
          new Map(existing).set(
            application.id,
            problemFor(error) === "unknown"
              ? copyFor(locale).actionStartFailed[1]
              : copyFor(locale).actionStartFailed[0],
          ),
        );
      }
    },
    [
      actionGenerations,
      generation,
      isCurrent,
      locale,
      poll,
      pollTimers,
      setActionFailures,
      setActions,
      setBusy,
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
      if (!action || terminalStates.has(action.state)) return;
      beginPolling(action);
    },
    [actions, beginPolling],
  );
}

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
  return {
    ...marker,
    actionGeneration: nextActionGeneration(application.id, context)
      .actionGeneration,
  };
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
  if (!terminalStates.has(action.state)) {
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
) {
  const attempt = beginHydrationAttempt(context, hydrated, application);
  if (!attempt) return;
  try {
    const action = await native.action(attempt.actionId);
    if (!isCurrentHydrationResult(context, application, attempt, action))
      return;
    await applyHydratedAction(context, action);
  } catch {
    discardFailedHydration(context, hydrated, application, attempt);
  }
}

function useActionHydrator(context: HydrationContext) {
  const hydrated = useRef(new Map<string, HydrationMarker>());
  const hydrateActions = useCallback(
    async (applications: AvailableApp[]) => {
      await Promise.all(
        applications.map((application) =>
          hydrateAction(context, hydrated.current, application),
        ),
      );
    },
    [context],
  );
  const resetHydration = useCallback(() => {
    hydrated.current.clear();
  }, []);
  return { hydrateActions, resetHydration };
}

export function useActionWorkflow(
  locale: Locale,
  mounted: MutableRefObject<boolean>,
  generation: MutableRefObject<number>,
  load: () => Promise<void>,
  pollTimers: PollTimerRegistry,
) {
  const [actions, setActions] = useState<Map<string, AppAction>>(
    () => new Map(),
  );
  const [actionFailures, setActionFailures] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [busy, setBusy] = useState<string>();
  const [polling, setPolling] = useState<Map<string, PollingState>>(
    () => new Map(),
  );
  const actionGenerations = useRef(new Map<string, number>());
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
    setActionFailures,
    setActions,
    setBusy,
    setPolling,
  });
  const resumeAction = useResumeAction(actions, beginPolling);
  const resetActions = useCallback(() => {
    pollTimers.clear();
    actionGenerations.current.clear();
    resetHydration();
    setActionFailures(new Map());
    setActions(new Map());
    setBusy(undefined);
    setPolling(new Map());
  }, [actionGenerations, pollTimers, resetHydration]);

  return {
    actionFailures,
    actions,
    busy,
    hydrateActions,
    polling,
    resetActions,
    resumeAction,
    setActions,
    startAction,
  };
}

export type ResumeAction = ReturnType<typeof useActionWorkflow>["resumeAction"];

export function isTerminalActionState(state: string) {
  return terminalStates.has(state);
}
