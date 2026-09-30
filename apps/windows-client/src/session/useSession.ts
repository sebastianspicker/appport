import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { copyFor, type Copy, type Locale } from "../i18n/copy";
import type { ClientProblem, ConnectRequest } from "../native-bridge/types";
import { native } from "../native-bridge/native";
import { problemFor } from "../native-bridge/problem";

/** The catalog capabilities that session changes need; the app composition supplies them. */
export type CatalogControl = {
  /** Invalidates prior catalog work, clears actions, and shows loading. */
  beginSignIn: () => void;
  /** Invalidates in-flight catalog work of the current session. */
  cancel: () => void;
  /** Removes the signed-out catalog and its actions, then shows `phase`. */
  clear: (phase: ClientProblem) => void;
  currentGeneration: () => number;
  load: () => Promise<void>;
  showProblem: (problem: ClientProblem) => void;
};

type ConnectContext = {
  catalog: CatalogControl;
  setWarning: Dispatch<SetStateAction<string | undefined>>;
  copy: Copy;
};

function createConnect({ catalog, setWarning, copy }: ConnectContext) {
  return async (request: ConnectRequest) => {
    catalog.beginSignIn();
    const requestGeneration = catalog.currentGeneration();
    setWarning(undefined);
    try {
      const started = await native.connect(request);
      if (catalog.currentGeneration() !== requestGeneration) return;
      setWarning(
        started.backgroundCheckRegistered
          ? undefined
          : copy.backgroundCheckUnavailable,
      );
      await catalog.load();
    } catch (error) {
      if (catalog.currentGeneration() === requestGeneration)
        catalog.showProblem(problemFor(error));
    }
  };
}

export function useConnect(locale: Locale, catalog: CatalogControl) {
  const [backgroundCheckWarning, setBackgroundCheckWarning] =
    useState<string>();
  const connect = useMemo(
    () =>
      createConnect({
        catalog,
        setWarning: setBackgroundCheckWarning,
        copy: copyFor(locale),
      }),
    [catalog, locale],
  );
  return { backgroundCheckWarning, connect };
}

type SignOutContext = {
  catalog: CatalogControl;
  copy: Copy;
  setWarning: Dispatch<SetStateAction<string | undefined>>;
};

function createSignOut({ catalog, copy, setWarning }: SignOutContext) {
  return async () => {
    setWarning(undefined);
    catalog.cancel();
    const outcome = await native.signOut().catch(() => undefined);
    if (!outcome) {
      setWarning(copy.signOutFailed);
      return;
    }
    if (!outcome.credentialRemoved) {
      setWarning(copy.signOutIncomplete);
      return;
    }
    catalog.clear("session-expired");
    setWarning(
      outcome.tokenRevocationRequired ||
        !outcome.scheduledTaskRemoved ||
        !outcome.notificationStateCleared
        ? copy.signOutPartial
        : undefined,
    );
  };
}

export function useSignOut(locale: Locale, catalog: CatalogControl) {
  const [signOutWarning, setSignOutWarning] = useState<string>();
  const signOut = useMemo(
    () =>
      createSignOut({
        catalog,
        copy: copyFor(locale),
        setWarning: setSignOutWarning,
      }),
    [catalog, locale],
  );
  return { signOut, signOutWarning };
}
