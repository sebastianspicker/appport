import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AppAction,
  AvailableApp,
  ConnectRequest,
  NativeBootstrap,
} from "../native-bridge/types";
import type {
  CatalogPhase,
  CatalogSetters,
  PollingState,
  SourceFilter,
  View,
} from "./types";
import type { useActionWorkflow } from "./useCatalogActions";
import type { useCatalogLoading } from "./useCatalogLoading";

export type Catalog = CatalogSetters & {
  actionFailures: ReadonlyMap<string, string>;
  actions: ReadonlyMap<string, AppAction>;
  apps: AvailableApp[];
  bootstrap: NativeBootstrap | undefined;
  busy: string | undefined;
  connect: (request: ConnectRequest) => Promise<void>;
  iconSession: number;
  load: ReturnType<typeof useCatalogLoading>;
  mounted: MutableRefObject<boolean>;
  phase: CatalogPhase;
  polling: ReadonlyMap<string, PollingState>;
  query: string;
  resumeAction: ReturnType<typeof useActionWorkflow>["resumeAction"];
  rows: AvailableApp[];
  setQuery: Dispatch<SetStateAction<string>>;
  setSourceFilter: Dispatch<SetStateAction<SourceFilter>>;
  setView: Dispatch<SetStateAction<View | undefined>>;
  signOut: () => Promise<void>;
  signOutWarning: string | undefined;
  sourceFilter: SourceFilter;
  startAction: ReturnType<typeof useActionWorkflow>["startAction"];
  view: View | undefined;
};
