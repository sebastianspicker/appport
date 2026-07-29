import { text, type Locale } from "./appCopy";
import { ActionButton } from "./ActionButton";
import { isTerminalActionState } from "./useAppCatalog";
import type { AvailableApp } from "./models";
import type { PollingState } from "./useAppCatalog";

export function ActionControl({
  application,
  busy,
  locale,
  state,
  onConfirm,
  polling,
  onResume,
}: {
  application: AvailableApp;
  busy: boolean;
  locale: Locale;
  state: string | null | undefined;
  onConfirm: (application: AvailableApp, opener: HTMLElement) => void;
  polling?: PollingState;
  onResume: (appId: string) => void;
}) {
  const copy = text[locale];
  if (state === "unknown") return null;
  if (polling === "paused")
    return (
      <button onClick={() => onResume(application.id)}>
        {copy.resumePolling}
      </button>
    );
  if (busy || (state && !isTerminalActionState(state)))
    return <button disabled>{copy.starting}</button>;
  return (
    <ActionButton
      application={application}
      locale={locale}
      onConfirm={onConfirm}
      state={state}
    />
  );
}
