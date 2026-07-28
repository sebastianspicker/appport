import { useMemo } from "react";
import { CatalogPage, type Catalog } from "./CatalogPage";
import { localeFor } from "./appCopy";
import { useActionWorkflow, useAppsState, useBootstrapState, useCatalogFilters, useCatalogLoading, useConnect, useInstalledState, useMounted, usePhaseState, useSignOut, useViewSelection } from "./useAppCatalog";

export function App() {
  const locale = localeFor(navigator.language);
  const [view, setView] = useViewSelection();
  const mounted = useMounted();
  const [bootstrap, setBootstrap] = useBootstrapState();
  const [apps, setApps] = useAppsState();
  const [installed, setInstalled] = useInstalledState();
  const [phase, setPhase] = usePhaseState();
  const setters = useMemo(() => ({ setApps, setBootstrap, setInstalled, setPhase }), [setApps, setBootstrap, setInstalled, setPhase]);
  const load = useCatalogLoading(view, mounted, setters);
  const filters = useCatalogFilters(view, apps, installed, locale);
  const actions = useActionWorkflow(locale, mounted, load, setPhase);
  const connect = useConnect(load, setPhase);
  const signOut = useSignOut(locale, setters, actions.setActions);
  const catalog: Catalog = { ...filters, ...actions, ...signOut, apps, bootstrap, connect, installed, load, mounted, phase, setApps, setBootstrap, setInstalled, setPhase, setView, view };
  return <CatalogPage catalog={catalog} locale={locale} />;
}
