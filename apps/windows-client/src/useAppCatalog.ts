import { useEffect, useMemo, useRef, useState } from "react";
import { text, type Copy, type Locale } from "./appCopy";
import type { AppAction, AppSource, AvailableApp, ClientProblem, InstalledApplication, NativeBootstrap } from "./models";
import { native } from "./native";

export type View = "apps" | "updates" | "installed";
export type SourceFilter = "all" | AppSource;
type Phase = "ready" | ClientProblem;
type CatalogList = AvailableApp[] | InstalledApplication[];

const terminalStates = new Set(["succeeded", "failed", "cancelled", "unknown"]);

function problemFor(error: unknown): ClientProblem {
  const code = (error as { code?: string })?.code;
  const problems: Record<string, ClientProblem> = { OFFLINE: "offline", SESSION_EXPIRED: "session-expired", DEVICE_MATCH_FAILED: "device-match-failed", SERVER: "server", ACTION: "action" };
  return problems[code ?? ""] ?? "unknown";
}

export function useViewSelection() {
  const [view, setView] = useState<View>();
  useEffect(() => { void native.initialView().then(setView).catch(() => setView("apps")); }, []);
  return [view, setView] as const;
}

async function fetchCatalog(view: View) {
  return Promise.all([native.bootstrap(), view === "installed" ? native.installed() : native.apps(view)]);
}

function storeCatalog(view: View, list: CatalogList, setApps: (apps: AvailableApp[]) => void, setInstalled: (apps: InstalledApplication[]) => void) {
  if (view === "installed") setInstalled(list as InstalledApplication[]);
  else setApps(list as AvailableApp[]);
}

type CatalogSetters = { setApps: (apps: AvailableApp[]) => void; setBootstrap: (bootstrap: NativeBootstrap | undefined) => void; setInstalled: (apps: InstalledApplication[]) => void; setPhase: (phase: Phase) => void };

async function loadCatalog(activeView: View | undefined, showLoading: boolean, mounted: React.MutableRefObject<boolean>, setters: CatalogSetters) {
  if (!activeView) return;
  startLoading(showLoading, setters.setPhase);
  try {
    commitCatalog(activeView, await fetchCatalog(activeView), mounted, setters);
  } catch (error) { reportLoadError(error, mounted, setters.setPhase); }
}

function startLoading(showLoading: boolean, setPhase: (phase: Phase) => void) { if (showLoading) setPhase("loading"); }

function commitCatalog(view: View, result: [NativeBootstrap, CatalogList], mounted: React.MutableRefObject<boolean>, setters: CatalogSetters) {
  if (!mounted.current) return;
  const [bootstrap, list] = result;
  setters.setBootstrap(bootstrap);
  storeCatalog(view, list, setters.setApps, setters.setInstalled);
  setters.setPhase(list.length ? "ready" : "empty");
}

function reportLoadError(error: unknown, mounted: React.MutableRefObject<boolean>, setPhase: (phase: Phase) => void) { if (mounted.current) setPhase(problemFor(error)); }

function createCatalogLoader(view: View | undefined, mounted: React.MutableRefObject<boolean>, setters: CatalogSetters) {
  return (activeView = view, showLoading = true) => loadCatalog(activeView, showLoading, mounted, setters);
}

export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

export function useBootstrapState() { return useState<NativeBootstrap>(); }
export function useAppsState() { return useState<AvailableApp[]>([]); }
export function useInstalledState() { return useState<InstalledApplication[]>([]); }
export function usePhaseState() { return useState<Phase>("loading"); }

export function useCatalogLoading(view: View | undefined, mounted: React.MutableRefObject<boolean>, setters: CatalogSetters) {
  const load = useMemo(() => createCatalogLoader(view, mounted, setters), [view, mounted, setters]);
  useEffect(() => { if (view) void load(view, false); }, [view, load]);
  return load;
}

function filterCatalog(entries: CatalogList, query: string, sourceFilter: SourceFilter, locale: Locale) {
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  return entries.filter((application) => (!normalizedQuery || application.name.toLocaleLowerCase(locale).includes(normalizedQuery)) && (sourceFilter === "all" || application.source === sourceFilter));
}

export function useCatalogFilters(view: View | undefined, apps: AvailableApp[], installed: InstalledApplication[], locale: Locale) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const entries = view === "installed" ? installed : apps;
  const rows = useMemo(() => filterCatalog(entries, query, sourceFilter, locale), [entries, query, sourceFilter, locale]);
  return { query, rows, setQuery, setSourceFilter, sourceFilter };
}

function saveAction(action: AppAction, setActions: React.Dispatch<React.SetStateAction<Record<string, AppAction>>>) {
  setActions((existing) => ({ ...existing, [action.appId]: action }));
}

function waitForActionPoll() { return new Promise((resolve) => window.setTimeout(resolve, 2_000)); }

async function pollAction(action: AppAction, mounted: React.MutableRefObject<boolean>, setActions: React.Dispatch<React.SetStateAction<Record<string, AppAction>>>, attempts = 150): Promise<AppAction | undefined> {
  if (!mounted.current) return undefined;
  if (attempts === 0 || terminalStates.has(action.state)) return action;
  await waitForActionPoll();
  if (!mounted.current) return undefined;
  const current = await native.action(action.id);
  saveAction(current, setActions);
  return pollAction(current, mounted, setActions, attempts - 1);
}

function unknownAction(action: AppAction, message: string): AppAction {
  return { ...action, state: "unknown", errorCode: "CLIENT_POLL_TIMEOUT", errorMessage: message };
}

async function finishAction(action: AppAction, locale: Locale, mounted: React.MutableRefObject<boolean>, setActions: React.Dispatch<React.SetStateAction<Record<string, AppAction>>>, load: () => Promise<void>) {
  const completed = await pollAction(action, mounted, setActions);
  if (!completed) return;
  const finalAction = terminalStates.has(completed.state) ? completed : unknownAction(completed, text[locale].unknownAction);
  if (finalAction !== completed) saveAction(finalAction, setActions);
  if (finalAction.state === "succeeded") await load();
}

function createActionStarter(locale: Locale, mounted: React.MutableRefObject<boolean>, load: () => Promise<void>, setActions: React.Dispatch<React.SetStateAction<Record<string, AppAction>>>, setBusy: (appId: string | undefined) => void, setPhase: (phase: Phase) => void) {
  return async (application: AvailableApp) => {
    setBusy(application.id);
    try {
      const started = await native.act(application.id);
      saveAction(started, setActions);
      setBusy(undefined);
      await finishAction(started, locale, mounted, setActions, load);
    } catch { setPhase("action"); setBusy(undefined); }
  };
}

export function useActionWorkflow(locale: Locale, mounted: React.MutableRefObject<boolean>, load: () => Promise<void>, setPhase: (phase: Phase) => void) {
  const [actions, setActions] = useState<Record<string, AppAction>>({});
  const [busy, setBusy] = useState<string>();
  const startAction = useMemo(() => createActionStarter(locale, mounted, load, setActions, setBusy, setPhase), [locale, mounted, load, setPhase]);
  return { actions, busy, setActions, startAction };
}

function createConnect(load: () => Promise<void>, setPhase: (phase: Phase) => void) {
  return async () => { setPhase("loading"); try { await native.beginConnect(); await load(); } catch (error) { setPhase(problemFor(error)); } };
}

export function useConnect(load: () => Promise<void>, setPhase: (phase: Phase) => void) {
  return useMemo(() => createConnect(load, setPhase), [load, setPhase]);
}

function createSignOut(copy: Copy, setBootstrap: (bootstrap: NativeBootstrap | undefined) => void, setApps: (apps: AvailableApp[]) => void, setInstalled: (apps: InstalledApplication[]) => void, setActions: (actions: Record<string, AppAction>) => void, setPhase: (phase: Phase) => void, setWarning: (warning: string | undefined) => void) {
  return async () => {
    const outcome = await native.signOut().catch(() => undefined);
    if (!outcome) { setWarning(copy.signOutFailed); return; }
    if (outcome.credentialDeletion === "failed") { setWarning(copy.signOutIncomplete); return; }
    setBootstrap(undefined); setApps([]); setInstalled([]); setActions({}); setPhase("session-expired");
    setWarning(outcome.remoteRevocation === "failed" || outcome.scheduledTaskRemoval === "failed" ? copy.signOutPartial : undefined);
  };
}

export function useSignOut(locale: Locale, setters: CatalogSetters, setActions: (actions: Record<string, AppAction>) => void) {
  const [signOutWarning, setSignOutWarning] = useState<string>();
  const signOut = useMemo(() => createSignOut(text[locale], setters.setBootstrap, setters.setApps, setters.setInstalled, setActions, setters.setPhase, setSignOutWarning), [locale, setters, setActions]);
  return { signOut, signOutWarning };
}

export function isTerminalActionState(state: string) { return terminalStates.has(state); }
