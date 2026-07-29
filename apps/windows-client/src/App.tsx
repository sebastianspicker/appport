import { useMemo } from "react";
import { CatalogPage, type Catalog } from "./CatalogPage";
import { localeFor } from "./appCopy";
import {
  useActionWorkflow,
  useAppsState,
  useBootstrapState,
  useCatalogFilters,
  useCatalogLoading,
  useConnect,
  useMounted,
  useOperationGeneration,
  usePhaseState,
  usePollTimerRegistry,
  useSignOut,
  useViewSelection,
} from "./useAppCatalog";

export function App() {
  const locale = localeFor(navigator.language);
  const [view, setView] = useViewSelection();
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
  const load = useCatalogLoading(view, mounted, operations.generation, setters);
  const filters = useCatalogFilters(apps, locale);
  const actions = useActionWorkflow(
    locale,
    mounted,
    operations.generation,
    load,
    pollTimers,
  );
  const connect = useConnect(
    locale,
    load,
    operations.cancel,
    operations.generation,
    setPhase,
  );
  const signOut = useSignOut(
    locale,
    operations.cancel,
    setters,
    actions.setActions,
  );
  const catalog: Catalog = {
    ...filters,
    ...actions,
    apps,
    bootstrap,
    connect: connect.connect,
    iconSession: operations.iconSession,
    load,
    mounted,
    phase,
    setApps,
    setBootstrap,
    setPhase,
    setView,
    signOut: signOut.signOut,
    signOutWarning: signOut.signOutWarning ?? connect.backgroundCheckWarning,
    view,
  };
  return <CatalogPage catalog={catalog} locale={locale} />;
}
