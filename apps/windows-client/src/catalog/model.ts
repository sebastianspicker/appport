import type { Dispatch, SetStateAction } from "react";
import type {
  AppAction,
  AppSource,
  AvailableApp,
  ClientProblem,
  NativeBootstrap,
} from "../native-bridge/types";

export type View = "apps" | "updates";
export type SourceFilter = "all" | AppSource;
export type PollingState = "polling" | "paused";
export type CatalogPhase = "ready" | ClientProblem;
export type ResumeAction = (appId: string) => void;

/** The catalog read model and commands rendered by the catalog feature. */
export type Catalog = {
  actionFailures: ReadonlyMap<string, string>;
  actions: ReadonlyMap<string, AppAction>;
  apps: AvailableApp[];
  bootstrap: NativeBootstrap | undefined;
  busyApps: ReadonlySet<string>;
  catalogRevision: string;
  iconSession: number;
  load: (
    activeView?: View,
    showLoading?: boolean,
    forceRefresh?: boolean,
  ) => Promise<void>;
  phase: CatalogPhase;
  polling: ReadonlyMap<string, PollingState>;
  query: string;
  resumeAction: ResumeAction;
  rows: AvailableApp[];
  selectView: (view: View) => void;
  setQuery: Dispatch<SetStateAction<string>>;
  setSourceFilter: Dispatch<SetStateAction<SourceFilter>>;
  sourceFilter: SourceFilter;
  startAction: (application: AvailableApp) => Promise<void>;
  view: View | undefined;
};
