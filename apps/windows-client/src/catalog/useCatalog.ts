import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../i18n/copy";
import type { AvailableApp, ClientProblem } from "../native-bridge/types";
import { resetIconSession } from "./iconPool";
import type { Catalog, SourceFilter, View } from "./model";
import { useActionWorkflow } from "./useActionWorkflow";
import { useCatalogLoading } from "./useCatalogLoading";
import { usePollTimerRegistry } from "./usePollTimerRegistry";
import { useViewSelection } from "./useViewSelection";

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** A session generation invalidates transient work without subscribing the UI to it. */
function useOperationGeneration(clearPollTimers: () => void) {
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

function useCatalogFilters(apps: AvailableApp[], locale: Locale) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const rows = useMemo(
    () => filterCatalog(apps, query, sourceFilter, locale),
    [apps, query, sourceFilter, locale],
  );
  return { query, rows, setQuery, setSourceFilter, sourceFilter };
}

/**
 * Owns catalog state for one window: the rendered read model and commands, and
 * the control that session changes use to invalidate and restart catalog work.
 */
export function useCatalog(locale: Locale) {
  const [view, setView, resolveView] = useViewSelection();
  const mounted = useMounted();
  const pollTimers = usePollTimerRegistry();
  const operations = useOperationGeneration(pollTimers.clear);
  const { generation, cancel } = operations;
  const loading = useCatalogLoading({
    generation,
    mounted,
    resolveView,
    view,
  });
  const { clear, load, setPhase } = loading;
  const filters = useCatalogFilters(loading.apps, locale);
  const { hydrateActions, resetActions, ...actions } = useActionWorkflow({
    generation,
    load,
    locale,
    mounted,
    pollTimers,
  });
  useEffect(() => {
    void hydrateActions(loading.apps);
  }, [loading.apps, hydrateActions]);
  const selectView = useCallback(
    (next: View) => {
      setPhase("loading");
      setView(next);
      void load(next, false);
    },
    [load, setPhase, setView],
  );
  const control = useMemo(
    () => ({
      beginSignIn: () => {
        cancel();
        resetActions();
        setPhase("loading");
      },
      cancel,
      clear: (phase: ClientProblem) => {
        resetActions();
        clear(phase);
      },
      currentGeneration: () => generation.current,
      load: () => load(),
      showProblem: (problem: ClientProblem) => setPhase(problem),
    }),
    [cancel, clear, generation, load, resetActions, setPhase],
  );
  const catalog: Catalog = {
    ...actions,
    ...filters,
    apps: loading.apps,
    bootstrap: loading.bootstrap,
    catalogRevision: loading.catalogRevision,
    iconSession: operations.iconSession,
    load,
    phase: loading.phase,
    selectView,
    view,
  };
  return { catalog, control };
}
