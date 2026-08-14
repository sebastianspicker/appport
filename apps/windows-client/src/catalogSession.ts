import { useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { copyFor, type Copy, type Locale } from "./appCopy";
import { native } from "./native";
import { problemFor, type CatalogSetters } from "./catalogTypes";

type ConnectContext = {
  load: () => Promise<void>;
  cancel: () => void;
  resetActions: () => void;
  generation: MutableRefObject<number>;
  setPhase: CatalogSetters["setPhase"];
  setWarning: Dispatch<SetStateAction<string | undefined>>;
  copy: Copy;
};

function createConnect({
  load,
  cancel,
  resetActions,
  generation,
  setPhase,
  setWarning,
  copy,
}: ConnectContext) {
  return async (relutionUsername: string, accessToken: string) => {
    cancel();
    resetActions();
    const requestGeneration = generation.current;
    setWarning(undefined);
    setPhase("loading");
    try {
      const started = await native.connect(relutionUsername, accessToken);
      if (generation.current !== requestGeneration) return;
      setWarning(
        started.backgroundCheckRegistered
          ? undefined
          : copy.backgroundCheckUnavailable,
      );
      await load();
    } catch (error) {
      if (generation.current === requestGeneration) setPhase(problemFor(error));
    }
  };
}

export function useConnect(
  locale: Locale,
  load: () => Promise<void>,
  cancel: () => void,
  resetActions: () => void,
  generation: MutableRefObject<number>,
  setPhase: CatalogSetters["setPhase"],
) {
  const [backgroundCheckWarning, setBackgroundCheckWarning] =
    useState<string>();
  const connect = useMemo(
    () =>
      createConnect({
        load,
        cancel,
        resetActions,
        generation,
        setPhase,
        setWarning: setBackgroundCheckWarning,
        copy: copyFor(locale),
      }),
    [cancel, generation, load, locale, resetActions, setPhase],
  );
  return { backgroundCheckWarning, connect };
}

type SignOutContext = {
  copy: Copy;
  cancel: () => void;
  setters: CatalogSetters;
  resetActions: () => void;
  setWarning: Dispatch<SetStateAction<string | undefined>>;
};

function createSignOut({
  copy,
  cancel,
  setters,
  resetActions,
  setWarning,
}: SignOutContext) {
  return async () => {
    cancel();
    const outcome = await native.signOut().catch(() => undefined);
    if (!outcome) {
      setWarning(copy.signOutFailed);
      return;
    }
    if (!outcome.credentialRemoved) {
      setWarning(copy.signOutIncomplete);
      return;
    }
    setters.setBootstrap(undefined);
    setters.setApps([]);
    resetActions();
    setters.setPhase("session-expired");
    setWarning(
      outcome.tokenRevocationRequired ||
        !outcome.scheduledTaskRemoved ||
        !outcome.notificationStateCleared
        ? copy.signOutPartial
        : undefined,
    );
  };
}

export function useSignOut(
  locale: Locale,
  cancel: () => void,
  setters: CatalogSetters,
  resetActions: () => void,
) {
  const [signOutWarning, setSignOutWarning] = useState<string>();
  const signOut = useMemo(
    () =>
      createSignOut({
        copy: copyFor(locale),
        cancel,
        setters,
        resetActions,
        setWarning: setSignOutWarning,
      }),
    [cancel, locale, resetActions, setters],
  );
  return { signOut, signOutWarning };
}
