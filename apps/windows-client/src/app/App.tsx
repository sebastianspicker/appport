import { useEffect, useMemo } from "react";
import { CatalogPage } from "../catalog/CatalogPage";
import { useActionWorkflow } from "../catalog/useCatalogActions";
import {
  useAppsState,
  useBootstrapState,
  useCatalogFilters,
  useCatalogLoading,
  usePhaseState,
} from "../catalog/useCatalogLoading";
import {
  useMounted,
  useOperationGeneration,
  usePollTimerRegistry,
  useViewSelection,
} from "../catalog/useCatalogLifecycle";
import { localeFor } from "../i18n/copy";
import { native } from "../native-bridge/native";
import { SessionControls } from "../session/SessionControls";
import { useConnect, useSignOut } from "../session/useSession";
import { SupportPanel } from "../support/SupportPanel";

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
    actions.resetActions,
    operations.generation,
    setPhase,
  );
  const signOut = useSignOut(
    locale,
    operations.cancel,
    setters,
    actions.resetActions,
  );
  useEffect(() => {
    void actions.hydrateActions(apps);
  }, [actions.hydrateActions, apps]);
  return (
    <CatalogPage
      catalog={{
        ...actions,
        ...filters,
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
        signOutWarning:
          signOut.signOutWarning ?? connect.backgroundCheckWarning,
        view,
      }}
      locale={locale}
      sessionControls={
        <SessionControls
          bootstrap={bootstrap}
          locale={locale}
          onConnect={connect.connect}
          onOpenPortal={native.openRelutionPortal}
          onSignOut={signOut.signOut}
        />
      }
      supportPanel={
        bootstrap ? (
          <SupportPanel bootstrap={bootstrap} locale={locale} />
        ) : null
      }
    />
  );
}
