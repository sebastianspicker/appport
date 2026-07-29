import { copyFor, type Locale } from "./appCopy";
import { ActionButton } from "./ActionButton";
import type { ConfirmationHandler } from "./catalogInteraction";
import { isTerminalActionState } from "./useAppCatalog";
import type { AvailableApp } from "./models";
import type { PollingState, ResumeAction } from "./useAppCatalog";

type ActionControlProps = {
  application: AvailableApp;
  busy: boolean;
  locale: Locale;
  state: string | null | undefined;
  onConfirm: ConfirmationHandler;
  polling?: PollingState;
  onResume: ResumeAction;
};

export function ActionControl(props: ActionControlProps) {
  const { application, busy, locale, state, onConfirm, polling, onResume } =
    props;
  const copy = copyFor(locale);
  if (state === "unknown") return null;
  if (polling === "paused")
    return (
      <button
        onClick={() => {
          onResume(application.id);
        }}
      >
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
