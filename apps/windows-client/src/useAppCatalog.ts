import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resetIconSession } from "./AppIcon";
import { text, type Copy, type Locale } from "./appCopy";
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
type CatalogSetters = {
  setApps: (apps: AvailableApp[]) => void;
  setBootstrap: (bootstrap: NativeBootstrap | undefined) => void;
  setPhase: (phase: Phase) => void;
};
type PollTimer = { resolve: () => void; timerId: number };
export type PollTimerRegistry = {
  clear: (appId?: string) => void;
  schedule: (appId: string) => Promise<void>;
};

const terminalStates = new Set(["succeeded", "failed", "cancelled", "unknown"]);
const pollIntervalMs = 2_000;
const maxPollAttempts = 150;

function problemFor(error: unknown): ClientProblem {
  const code = (error as { code?: string })?.code;
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
      .catch(() => setView("apps"));
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
  useEffect(() => () => clear(), [clear]);
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

export function useBootstrapState() {
  return useState<NativeBootstrap>();
}
export function useAppsState() {
  return useState<AvailableApp[]>([]);
}
export function usePhaseState() {
  return useState<Phase>("loading");
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
          !mounted.current ||
          generation.current !== currentGeneration ||
          requestId.current !== currentRequest
        )
          return;
        setters.setBootstrap(bootstrap);
        setters.setApps(apps);
        setters.setPhase(apps.length ? "ready" : "empty");
      } catch (error) {
        if (
          mounted.current &&
          generation.current === currentGeneration &&
          requestId.current === currentRequest
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
  setActions: React.Dispatch<React.SetStateAction<Record<string, AppAction>>>,
) {
  setActions((existing) => ({ ...existing, [action.appId]: action }));
}

function withoutKey<Value>(entries: Record<string, Value>, key: string) {
  const next = { ...entries };
  delete next[key];
  return next;
}

export function useActionWorkflow(
  locale: Locale,
  mounted: React.MutableRefObject<boolean>,
  generation: React.MutableRefObject<number>,
  load: () => Promise<void>,
  pollTimers: PollTimerRegistry,
) {
  const [actions, setActions] = useState<Record<string, AppAction>>({});
  const [actionFailures, setActionFailures] = useState<Record<string, string>>(
    {},
  );
  const [busy, setBusy] = useState<string>();
  const [polling, setPolling] = useState<Record<string, PollingState>>({});
  const actionGenerations = useRef(new Map<string, number>());

  const isCurrent = useCallback(
    (appId: string, actionGeneration: number, sessionGeneration: number) =>
      mounted.current &&
      generation.current === sessionGeneration &&
      actionGenerations.current.get(appId) === actionGeneration,
    [generation, mounted],
  );

  const poll = useCallback(
    async (
      action: AppAction,
      actionGeneration: number,
      sessionGeneration: number,
    ) => {
      let current = action;
      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        if (!isCurrent(action.appId, actionGeneration, sessionGeneration))
          return;
        if (terminalStates.has(current.state)) {
          pollTimers.clear(current.appId);
          setPolling((existing) => withoutKey(existing, current.appId));
          if (current.state === "succeeded") await load();
          return;
        }
        await pollTimers.schedule(action.appId);
        if (!isCurrent(action.appId, actionGeneration, sessionGeneration))
          return;
        try {
          const next = await native.action(current.id);
          if (!isCurrent(action.appId, actionGeneration, sessionGeneration))
            return;
          current = next;
          saveAction(current, setActions);
        } catch {
          if (isCurrent(action.appId, actionGeneration, sessionGeneration))
            setPolling((existing) => ({
              ...existing,
              [action.appId]: "paused",
            }));
          return;
        }
      }
      if (isCurrent(action.appId, actionGeneration, sessionGeneration))
        setPolling((existing) => ({ ...existing, [action.appId]: "paused" }));
    },
    [isCurrent, load, pollTimers],
  );

  const beginPolling = useCallback(
    (action: AppAction) => {
      pollTimers.clear(action.appId);
      const actionGeneration =
        (actionGenerations.current.get(action.appId) ?? 0) + 1;
      const sessionGeneration = generation.current;
      actionGenerations.current.set(action.appId, actionGeneration);
      setPolling((existing) => ({ ...existing, [action.appId]: "polling" }));
      void poll(action, actionGeneration, sessionGeneration);
    },
    [generation, poll, pollTimers],
  );

  const startAction = useCallback(
    async (application: AvailableApp) => {
      pollTimers.clear(application.id);
      const actionGeneration =
        (actionGenerations.current.get(application.id) ?? 0) + 1;
      const sessionGeneration = generation.current;
      actionGenerations.current.set(application.id, actionGeneration);
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
        setPolling((existing) => ({
          ...existing,
          [application.id]: "polling",
        }));
        void poll(started, actionGeneration, sessionGeneration);
      } catch (error) {
        if (!isCurrent(application.id, actionGeneration, sessionGeneration))
          return;
        setBusy((current) =>
          current === application.id ? undefined : current,
        );
        setActionFailures((existing) => ({
          ...existing,
          [application.id]:
            problemFor(error) === "unknown"
              ? text[locale].action[1]
              : text[locale].action[0],
        }));
      }
    },
    [generation, isCurrent, locale, poll, pollTimers],
  );

  const resumeAction = useCallback(
    (appId: string) => {
      const action = actions[appId];
      if (!action || terminalStates.has(action.state)) return;
      beginPolling(action);
    },
    [actions, beginPolling],
  );

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

function createConnect(
  load: () => Promise<void>,
  cancel: () => void,
  generation: React.MutableRefObject<number>,
  setPhase: (phase: Phase) => void,
  setWarning: (warning: string | undefined) => void,
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
  setPhase: (phase: Phase) => void,
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
        text[locale],
      ),
    [cancel, generation, load, locale, setPhase],
  );
  return { backgroundCheckWarning, connect };
}

function createSignOut(
  copy: Copy,
  cancel: () => void,
  setBootstrap: (bootstrap: NativeBootstrap | undefined) => void,
  setApps: (apps: AvailableApp[]) => void,
  setActions: (actions: Record<string, AppAction>) => void,
  setPhase: (phase: Phase) => void,
  setWarning: (warning: string | undefined) => void,
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
    setBootstrap(undefined);
    setApps([]);
    setActions({});
    setPhase("session-expired");
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
  setActions: (actions: Record<string, AppAction>) => void,
) {
  const [signOutWarning, setSignOutWarning] = useState<string>();
  const signOut = useMemo(
    () =>
      createSignOut(
        text[locale],
        cancel,
        setters.setBootstrap,
        setters.setApps,
        setActions,
        setters.setPhase,
        setSignOutWarning,
      ),
    [cancel, locale, setters, setActions],
  );
  return { signOut, signOutWarning };
}

export function isTerminalActionState(state: string) {
  return terminalStates.has(state);
}
