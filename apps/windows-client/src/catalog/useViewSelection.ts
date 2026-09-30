import { useCallback, useEffect, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { native } from "../native-bridge/native";
import type { View } from "./model";

export function useViewSelection() {
  const [view, setView] = useState<View>();
  const currentView = useRef<View | undefined>(undefined);
  const initialView = useRef<Promise<View> | undefined>(undefined);
  const selectView = useCallback((next: SetStateAction<View | undefined>) => {
    setView((previous) => {
      const selected = typeof next === "function" ? next(previous) : next;
      currentView.current = selected;
      return selected;
    });
  }, []);
  const resolveView = useCallback(() => {
    if (currentView.current) return Promise.resolve(currentView.current);
    const requestedView =
      initialView.current ?? native.initialView().catch(() => "apps" as const);
    initialView.current = requestedView;
    return requestedView;
  }, []);
  useEffect(() => {
    let active = true;
    void resolveView().then((selectedView) => {
      if (active) selectView(selectedView);
    });
    return () => {
      active = false;
    };
  }, [resolveView, selectView]);
  return [view, selectView, resolveView] as const;
}
