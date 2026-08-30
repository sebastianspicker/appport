import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Locale } from "../i18n/copy";
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

export type CatalogSetters = {
  setApps: Dispatch<SetStateAction<AvailableApp[]>>;
  setBootstrap: Dispatch<SetStateAction<NativeBootstrap | undefined>>;
  setPhase: Dispatch<SetStateAction<CatalogPhase>>;
};

export type PollTimerRegistry = {
  clear: (appId?: string) => void;
  schedule: (appId: string) => Promise<void>;
};

export type ActionGenerationContext = {
  actionGenerations: MutableRefObject<Map<string, number>>;
  generation: MutableRefObject<number>;
};

export type ActionPollingContext = ActionGenerationContext & {
  load: () => Promise<void>;
  mounted: MutableRefObject<boolean>;
  pollTimers: PollTimerRegistry;
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>;
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>;
};

export type ActionStartContext = ActionGenerationContext & {
  isCurrent: (
    appId: string,
    actionGeneration: number,
    sessionGeneration: number,
  ) => boolean;
  locale: Locale;
  poll: (
    action: AppAction,
    actionGeneration: number,
    sessionGeneration: number,
  ) => Promise<void>;
  pollTimers: PollTimerRegistry;
  setActionFailures: Dispatch<SetStateAction<Map<string, string>>>;
  setActions: Dispatch<SetStateAction<Map<string, AppAction>>>;
  setBusy: Dispatch<SetStateAction<string | undefined>>;
  setPolling: Dispatch<SetStateAction<Map<string, PollingState>>>;
};

export function withoutKey<Value>(
  entries: ReadonlyMap<string, Value>,
  key: string,
) {
  const next = new Map(entries);
  next.delete(key);
  return next;
}
