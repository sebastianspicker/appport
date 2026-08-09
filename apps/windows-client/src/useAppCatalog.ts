import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { resetIconSession } from "./AppIcon";
import { copyFor, type Copy, type Locale } from "./appCopy";
import type {
  AppAction,
  AppSource,
  AvailableApp,
  ClientProblem,
  NativeBootstrap,
} from "./models";
import { native } from "./native";

export type View = "apps" | "updates";
export type SourceFilter = "all" | AppSource;
export type PollingState = "polling" | "paused";
type Phase = "ready" | ClientProblem;
export type CatalogSetters = {
  setApps: ReturnType<typeof useAppsState>[1];
  setBootstrap: ReturnType<typeof useBootstrapState>[1];
  setPhase: ReturnType<typeof usePhaseState>[1];
};
type PollTimer = { resolve: () => void; timerId: number };

const terminalStates = new Set(["succeeded", "failed", "cancelled", "unknown"]);
const pollIntervalMs = 2_000;
const maxPollAttempts = 150;

function problemFor(error: unknown): ClientProblem {
  const code = (error as { code?: string } | null | undefined)?.code;
  const problems: Record<string, ClientProblem> = {
    OFFLINE: "offline",
    SESSION_EXPIRED: "session-expired",
    DEVICE_MATCH_FAILED: "device-match-failed",
    SERVER: "server",
    ACTION: "action",
  };
  return problems[code ?? ""] ?? "unknown";
}

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

export function usePollTimerRegistry() {
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
  useEffect(() => {
    return () => {
      clear();
    };
  }, [clear]);
  return useMemo(() => ({ clear, schedule }), [clear, schedule]);
}

export type PollTimerRegistry = ReturnType<typeof usePollTimerRegistry>;

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

export function useBootstrapState() {
  return useState<NativeBootstrap>();
}
export function useAppsState() {
  return useState<AvailableApp[]>([]);
}
export function usePhaseState() {
  return useState<Phase>("loading");
}

function isCurrentRequest(
  mounted: React.MutableRefObject<boolean>,
  generation: React.MutableRefObject<number>,
  requestId: React.MutableRefObject<number>,
  currentGeneration: number,
  currentRequest: number,
) {
  return (
    mounted.current &&
    generation.current === currentGeneration &&
    requestId.current === currentRequest
  );
}

function applyCatalog(
  setters: CatalogSetters,
  bootstrap: NativeBootstrap,
  apps: AvailableApp[],
) {
  setters.setBootstrap(bootstrap);
  setters.setApps(apps);
  setters.setPhase(apps.length ? "ready" : "empty");
}

export function useCatalogLoading(
  view: View | undefined,
  mounted: React.MutableRefObject<boolean>,
  generation: React.MutableRefObject<number>,
  setters: CatalogSetters,
) {
  const requestId = useRef(0);
  const load = useCallback(
    async (activeView = view, showLoading = true) => {
      if (!activeView) return;
      const currentRequest = ++requestId.current;
      const currentGeneration = generation.current;
      if (showLoading) setters.setPhase("loading");
      try {
        const [bootstrap, apps] = await Promise.all([
          native.bootstrap(),
          native.apps(activeView),
        ]);
        if (
          !isCurrentRequest(
            mounted,
            generation,
            requestId,
            currentGeneration,
            currentRequest,
          )
        )
          return;
        applyCatalog(setters, bootstrap, apps);
      } catch (error) {
        if (
          isCurrentRequest(
            mounted,
            generation,
            requestId,
            currentGeneration,
            currentRequest,
          )
        )
          setters.setPhase(problemFor(error));
      }
    },
    [generation, mounted, setters, view],
  );
  useEffect(() => {
    if (view) void load(view, false);
  }, [view, load]);
  return load;
}

function filterCatalog(
  entries: AvailableApp[],
  query: string,
  sourceFilter: SourceFilter,
  locale: Locale,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  return entries.filter(
    (application) =>
      (!normalizedQuery ||
        application.name.toLocaleLowerCase(locale).includes(normalizedQuery)) &&
      (sourceFilter === "all" || application.source === sourceFilter),
  );
}

export function useCatalogFilters(apps: AvailableApp[], locale: Locale) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const rows = useMemo(
    () => filterCatalog(apps, query, sourceFilter, locale),
    [apps, query, sourceFilter, locale],
  );
  return { query, rows, setQuery, setSourceFilter, sourceFilter };
}

function saveAction(
  action: AppAction,
  setActions: React.Dispatch<React.SetStateAction<Map<string, AppAction>>>,
) {
  setActions((existing) => new Map(existing).set(action.appId, action));
}

function withoutKey<Value>(entries: ReadonlyMap<string, Value>, key: string) {
  const next = new Map(entries);
  next.delete(key);
  return next;
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

type ActionGenerationContext = {
  actionGenerations: MutableRefObject<Map<string, number>>;
  generation: MutableRefObject<number>;
};

type ActionPollingContext = ActionGenerationContext & {
  load: () => Promise<void>;
  mounted: MutableRefObject<boolean>;
  pollTimers: PollTimerRegistry;
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>;
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>;
};

type ActionStartContext = ActionGenerationContext & {
  isCurrent: (
    appId: string,
    actionGeneration: number,
    sessionGeneration: number,
  ) => boolean;
  locale: Locale;
  poll: (
    action: AppAction,
    actionGeneration: number,
    sessionGeneration: number,
  ) => Promise<void>;
  pollTimers: PollTimerRegistry;
  setActionFailures: Dispatch<SetStateAction<Map<string, string>>>;
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>;
  setBusy: Dispatch<SetStateAction<string | undefined>>;
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>;
};

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

export function useActionWorkflow(
  locale: Locale,
  mounted: React.MutableRefObject<boolean>,
  generation: React.MutableRefObject<number>,
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

  return {
    actionFailures,
    actions,
    busy,
    polling,
    resumeAction,
    setActions,
    startAction,
  };
}

export type ResumeAction = ReturnType<typeof useActionWorkflow>["resumeAction"];

function createConnect(
  load: () => Promise<void>,
  cancel: () => void,
  generation: React.MutableRefObject<number>,
  setPhase: CatalogSetters["setPhase"],
  setWarning: Dispatch<SetStateAction<string | undefined>>,
  copy: Copy,
) {
  return async (relutionUsername: string, accessToken: string) => {
    cancel();
    const requestGeneration = generation.current;
    setWarning(undefined);
    setPhase("loading");
    try {
      const started = await native.connect(relutionUsername, accessToken);
      if (generation.current !== requestGeneration) return;
      setWarning(
        started.backgroundCheckRegistered
          ? undefined
          : copy.backgroundCheckUnavailable,
      );
      await load();
    } catch (error) {
      if (generation.current === requestGeneration) setPhase(problemFor(error));
    }
  };
}

export function useConnect(
  locale: Locale,
  load: () => Promise<void>,
  cancel: () => void,
  generation: React.MutableRefObject<number>,
  setPhase: CatalogSetters["setPhase"],
) {
  const [backgroundCheckWarning, setBackgroundCheckWarning] =
    useState<string>();
  const connect = useMemo(
    () =>
      createConnect(
        load,
        cancel,
        generation,
        setPhase,
        setBackgroundCheckWarning,
        copyFor(locale),
      ),
    [cancel, generation, load, locale, setPhase],
  );
  return { backgroundCheckWarning, connect };
}

function createSignOut(
  copy: Copy,
  cancel: () => void,
  setters: CatalogSetters,
  setActions: React.Dispatch<React.SetStateAction<Map<string, AppAction>>>,
  setWarning: Dispatch<SetStateAction<string | undefined>>,
) {
  return async () => {
    cancel();
    const outcome = await native.signOut().catch(() => undefined);
    if (!outcome) {
      setWarning(copy.signOutFailed);
      return;
    }
    if (!outcome.credentialRemoved) {
      setWarning(copy.signOutIncomplete);
      return;
    }
    setters.setBootstrap(undefined);
    setters.setApps([]);
    setActions(new Map());
    setters.setPhase("session-expired");
    setWarning(
      outcome.tokenRevocationRequired ||
        !outcome.scheduledTaskRemoved ||
        !outcome.notificationStateCleared
        ? copy.signOutPartial
        : undefined,
    );
  };
}

export function useSignOut(
  locale: Locale,
  cancel: () => void,
  setters: CatalogSetters,
  setActions: React.Dispatch<React.SetStateAction<Map<string, AppAction>>>,
) {
  const [signOutWarning, setSignOutWarning] = useState<string>();
  const signOut = useMemo(
    () =>
      createSignOut(
        copyFor(locale),
        cancel,
        setters,
        setActions,
        setSignOutWarning,
      ),
    [cancel, locale, setters, setActions],
  );
  return { signOut, signOutWarning };
}

export function isTerminalActionState(state: string) {
  return terminalStates.has(state);
}
