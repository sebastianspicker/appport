import type { Catalog } from "./catalogModel";
import {
  type useActionWorkflow,
  type useCatalogFilters,
  type useConnect,
  type useOperationGeneration,
  type useSignOut,
} from "./useAppCatalog";

type CatalogInputs = Omit<
  Catalog,
  | "iconSession"
  | "signOutWarning"
  | "startAction"
  | "resumeAction"
  | "actions"
  | "actionFailures"
  | "busy"
  | "polling"
  | "query"
  | "rows"
  | "setQuery"
  | "setSourceFilter"
  | "sourceFilter"
  | "connect"
  | "signOut"
> & {
  actions: ReturnType<typeof useActionWorkflow>;
  connect: ReturnType<typeof useConnect>;
  filters: ReturnType<typeof useCatalogFilters>;
  operations: ReturnType<typeof useOperationGeneration>;
  signOut: ReturnType<typeof useSignOut>;
};

export function buildCatalog(inputs: CatalogInputs): Catalog {
  const {
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
  } = inputs;
  return {
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
}
