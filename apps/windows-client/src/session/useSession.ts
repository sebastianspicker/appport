import { useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { copyFor, type Copy, type Locale } from "../i18n/copy";
import type {
  AvailableApp,
  ClientProblem,
  ConnectRequest,
  NativeBootstrap,
} from "../native-bridge/types";
import { native } from "../native-bridge/native";
import { problemFor } from "../native-bridge/problem";

type SessionSetters = {
  setApps: Dispatch<SetStateAction<AvailableApp[]>>;
  setBootstrap: Dispatch<SetStateAction<NativeBootstrap | undefined>>;
  setPhase: Dispatch<SetStateAction<"ready" | ClientProblem>>;
};

type ConnectContext = {
  load: () => Promise<void>;
  cancel: () => void;
  resetActions: () => void;
  generation: MutableRefObject<number>;
  setPhase: SessionSetters["setPhase"];
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
  return async (request: ConnectRequest) => {
    cancel();
    resetActions();
    const requestGeneration = generation.current;
    setWarning(undefined);
    setPhase("loading");
    try {
      const started = await native.connect(request);
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
  setPhase: SessionSetters["setPhase"],
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
  setters: SessionSetters;
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
  setters: SessionSetters,
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
