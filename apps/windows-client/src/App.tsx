import { useEffect, useMemo } from "react";
import { CatalogPage } from "./CatalogPage";
import { localeFor } from "./appCopy";
import { buildCatalog } from "./buildCatalog";
import {
  useAppsState,
  useBootstrapState,
  useCatalogFilters,
  useCatalogLoading,
  useMounted,
  useOperationGeneration,
  usePhaseState,
  usePollTimerRegistry,
  useViewSelection,
} from "./useAppCatalog";
import { useClientOperations } from "./useClientOperations";

export function App() {
  const locale = localeFor(navigator.language);
  const [view, setView, resolveView] = useViewSelection();
  const mounted = useMounted();
  const pollTimers = usePollTimerRegistry();
  const operations = useOperationGeneration(pollTimers.clear);
  const [bootstrap, setBootstrap] = useBootstrapState();
  const [apps, setApps] = useAppsState();
  const [phase, setPhase] = usePhaseState();
  const setters = useMemo(
    () => ({ setApps, setBootstrap, setPhase }),
    [setApps, setBootstrap, setPhase],
  );
  const load = useCatalogLoading(
    view,
    resolveView,
    mounted,
    operations.generation,
    setters,
  );
  const filters = useCatalogFilters(apps, locale);
  const { actions, connect, signOut } = useClientOperations(
    locale,
    mounted,
    operations.generation,
    load,
    pollTimers,
    operations.cancel,
    setters,
  );
  useEffect(() => {
    void actions.hydrateActions(apps);
  }, [actions.hydrateActions, apps]);
  return (
    <CatalogPage
      catalog={buildCatalog({
        actions,
        apps,
        bootstrap,
        connect,
        filters,
        load,
        mounted,
        operations,
        phase,
        setApps,
        setBootstrap,
        setPhase,
        setView,
        signOut,
        view,
      })}
      locale={locale}
    />
  );
}
