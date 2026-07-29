import type { Locale } from "./appCopy";
import {
  useActionWorkflow,
  useConnect,
  useSignOut,
  type PollTimerRegistry,
} from "./useAppCatalog";
import type { MutableRefObject } from "react";
import type { CatalogSetters } from "./useAppCatalog";

export function useClientOperations(
  locale: Locale,
  mounted: MutableRefObject<boolean>,
  generation: MutableRefObject<number>,
  load: () => Promise<void>,
  pollTimers: PollTimerRegistry,
  cancel: () => void,
  setters: CatalogSetters,
) {
  const actions = useActionWorkflow(
    locale,
    mounted,
    generation,
    load,
    pollTimers,
  );
  const connect = useConnect(
    locale,
    load,
    cancel,
    generation,
    setters.setPhase,
  );
  const signOut = useSignOut(locale, cancel, setters, actions.setActions);
  return { actions, connect, signOut };
}
