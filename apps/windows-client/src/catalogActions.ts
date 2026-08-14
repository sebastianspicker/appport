import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { copyFor, type Locale } from "./appCopy";
import type { AppAction, AvailableApp } from "./models";
import { native } from "./native";
import {
  problemFor,
  withoutKey,
  type ActionGenerationContext,
  type ActionPollingContext,
  type ActionStartContext,
  type PollingState,
  type PollTimerRegistry,
} from "./catalogTypes";

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
              ? copyFor(locale).action[1]
              : copyFor(locale).action[0],
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

function useActionHydrator({
  actionGenerations,
  beginPolling,
  generation,
  isCurrent,
  load,
  mounted,
  pollTimers,
  setActions,
  setPolling,
}: {
  actionGenerations: MutableRefObject<Map<string, number>>;
  beginPolling: (action: AppAction) => void;
  generation: MutableRefObject<number>;
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
}) {
  const hydrated = useRef(new Map<string, HydrationMarker>());
  const hydrateActions = useCallback(
    async (applications: AvailableApp[]) => {
      const requests = applications.flatMap((application) => {
        const actionId = application.activeActionId;
        const sessionGeneration = generation.current;
        if (!actionId) return [];
        const previous = hydrated.current.get(application.id);
        if (
          previous?.actionId === actionId &&
          previous.sessionGeneration === sessionGeneration
        )
          return [];
        hydrated.current.set(application.id, { actionId, sessionGeneration });
        const { actionGeneration } = nextActionGeneration(application.id, {
          actionGenerations,
          generation,
        });
        return (async () => {
          try {
            const action = await native.action(actionId);
            if (!isCurrent(application.id, actionGeneration, sessionGeneration))
              return;
            if (action.id !== actionId || action.appId !== application.id)
              return;
            saveAction(action, setActions);
            if (terminalStates.has(action.state)) {
              await completeTerminalAction(
                action,
                pollTimers,
                setPolling,
                load,
              );
              return;
            }
            beginPolling(action);
          } catch {
            if (
              mounted.current &&
              generation.current === sessionGeneration &&
              actionGenerations.current.get(application.id) === actionGeneration
            )
              hydrated.current.delete(application.id);
          }
        })();
      });
      await Promise.all(requests);
    },
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
  const { hydrateActions, resetHydration } = useActionHydrator({
    actionGenerations,
    beginPolling,
    generation,
    isCurrent,
    load,
    mounted,
    pollTimers,
    setActions,
    setPolling,
  });
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
