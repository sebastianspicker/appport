import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AppAction,
  AvailableApp,
  ClientProblem,
  NativeBootstrap,
} from "./models";
import type {
  PollingState,
  SourceFilter,
  View,
  useActionWorkflow,
  useCatalogLoading,
  useConnect,
} from "./useAppCatalog";

type Phase = "ready" | ClientProblem;

export type Catalog = {
  actionFailures: ReadonlyMap<string, string>;
  actions: ReadonlyMap<string, AppAction>;
  apps: AvailableApp[];
  bootstrap: NativeBootstrap | undefined;
  busy: string | undefined;
  connect: ReturnType<typeof useConnect>["connect"];
  iconSession: number;
  load: ReturnType<typeof useCatalogLoading>;
  mounted: MutableRefObject<boolean>;
  phase: Phase;
  polling: ReadonlyMap<string, PollingState>;
  query: string;
  resumeAction: ReturnType<typeof useActionWorkflow>["resumeAction"];
  rows: AvailableApp[];
  setApps: Dispatch<SetStateAction<AvailableApp[]>>;
  setBootstrap: Dispatch<SetStateAction<NativeBootstrap | undefined>>;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setSourceFilter: Dispatch<SetStateAction<SourceFilter>>;
  setView: Dispatch<SetStateAction<View | undefined>>;
  signOut: () => Promise<void>;
  signOutWarning: string | undefined;
  sourceFilter: SourceFilter;
  startAction: ReturnType<typeof useActionWorkflow>["startAction"];
  view: View | undefined;
};
