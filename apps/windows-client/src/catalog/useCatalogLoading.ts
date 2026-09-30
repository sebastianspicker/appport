import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { AvailableApp, NativeBootstrap } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import { setIconCatalogRevision } from "./iconPool";
import { problemFor } from "../native-bridge/problem";
import type { CatalogPhase, View } from "./model";

type CatalogLoadingOptions = {
  generation: MutableRefObject<number>;
  mounted: MutableRefObject<boolean>;
  resolveView: () => Promise<View>;
  view: View | undefined;
};

function isCurrentRequest(
  mounted: MutableRefObject<boolean>,
  generation: MutableRefObject<number>,
  requestId: MutableRefObject<number>,
  currentGeneration: number,
  currentRequest: number,
) {
  return (
    mounted.current &&
    generation.current === currentGeneration &&
    requestId.current === currentRequest
  );
}

/** Owns the loaded catalog snapshot and fences each request by session and request id. */
export function useCatalogLoading({
  generation,
  mounted,
  resolveView,
  view,
}: CatalogLoadingOptions) {
  const [bootstrap, setBootstrap] = useState<NativeBootstrap>();
  const [apps, setApps] = useState<AvailableApp[]>([]);
  const [phase, setPhase] = useState<CatalogPhase>("loading");
  const [catalogRevision, setCatalogRevision] = useState("");
  const requestId = useRef(0);
  const requestedView = useRef<View | undefined>(undefined);
  const load = useCallback(
    async (activeView?: View, showLoading = true, forceRefresh = false) => {
      const currentRequest = ++requestId.current;
      const currentGeneration = generation.current;
      if (showLoading) setPhase("loading");
      const selectedView = activeView ?? (await resolveView());
      if (
        !isCurrentRequest(
          mounted,
          generation,
          requestId,
          currentGeneration,
          currentRequest,
        )
      )
        return;
      requestedView.current = selectedView;
      try {
        const snapshot = await native.loadCatalog({
          view: selectedView,
          forceRefresh,
        });
        if (
          !isCurrentRequest(
            mounted,
            generation,
            requestId,
            currentGeneration,
            currentRequest,
          )
        )
          return;
        setIconCatalogRevision(snapshot.catalogRevision);
        setCatalogRevision(snapshot.catalogRevision);
        setBootstrap(snapshot.bootstrap);
        setApps(snapshot.apps);
        setPhase(snapshot.apps.length ? "ready" : "empty");
      } catch (error) {
        if (
          isCurrentRequest(
            mounted,
            generation,
            requestId,
            currentGeneration,
            currentRequest,
          )
        )
          setPhase(problemFor(error));
      }
    },
    [generation, mounted, resolveView],
  );
  useEffect(() => {
    if (view && requestedView.current !== view) void load(view, false);
  }, [view, load]);
  const clear = useCallback((next: CatalogPhase) => {
    setBootstrap(undefined);
    setApps([]);
    setPhase(next);
  }, []);
  return { apps, bootstrap, catalogRevision, clear, load, phase, setPhase };
}
