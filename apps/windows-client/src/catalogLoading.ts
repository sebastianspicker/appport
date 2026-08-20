import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { Locale } from "./appCopy";
import type { AvailableApp, NativeBootstrap } from "./models";
import { native } from "./native";
import {
  problemFor,
  type CatalogPhase,
  type CatalogSetters,
  type SourceFilter,
  type View,
} from "./catalogTypes";

function isCurrentRequest(
  mounted: MutableRefObject<boolean>,
  generation: MutableRefObject<number>,
  requestId: MutableRefObject<number>,
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

export function useBootstrapState() {
  return useState<NativeBootstrap>();
}

export function useAppsState() {
  return useState<AvailableApp[]>([]);
}

export function usePhaseState() {
  return useState<CatalogPhase>("loading");
}

export function useCatalogLoading(
  view: View | undefined,
  resolveView: () => Promise<View>,
  mounted: MutableRefObject<boolean>,
  generation: MutableRefObject<number>,
  setters: CatalogSetters,
) {
  const requestId = useRef(0);
  const requestedView = useRef<View | undefined>(undefined);
  const load = useCallback(
    async (activeView?: View, showLoading = true) => {
      const currentRequest = ++requestId.current;
      const currentGeneration = generation.current;
      if (showLoading) setters.setPhase("loading");
      const selectedView = activeView ?? (await resolveView());
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
      requestedView.current = selectedView;
      try {
        const [bootstrap, apps] = await Promise.all([
          native.bootstrap(),
          native.apps(selectedView),
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
    [generation, mounted, resolveView, setters],
  );
  useEffect(() => {
    if (view && requestedView.current !== view) void load(view, false);
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
