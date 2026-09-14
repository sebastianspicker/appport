import { copyFor, type Locale } from "../i18n/copy";
import { ActionButton } from "./ActionButton";
import type { ConfirmationHandler } from "./confirmation";
import { isTerminalActionState, type ResumeAction } from "./useCatalogActions";
import type { AvailableApp } from "../native-bridge/types";
import type { PollingState } from "./types";

type ActionControlProps = {
  application: AvailableApp;
  busy: boolean;
  locale: Locale;
  state: string | null | undefined;
  onConfirm: ConfirmationHandler;
  polling?: PollingState;
  onResume: ResumeAction;
  writesEnabled: boolean;
};

export function ActionControl(props: ActionControlProps) {
  const {
    application,
    busy,
    locale,
    state,
    onConfirm,
    polling,
    onResume,
    writesEnabled,
  } = props;
  const copy = copyFor(locale);
  if (state === "unknown" || state === "succeeded") return null;
  if (polling === "paused")
    return (
      <button
        className="action-button secondary"
        onClick={() => {
          onResume(application.id);
        }}
      >
        {copy.resumePolling}
      </button>
    );
  if (busy || (state && !isTerminalActionState(state)))
    return (
      <button className="action-button secondary" disabled>
        {copy.starting}
      </button>
    );
  if (!writesEnabled) return null;
  return (
    <ActionButton
      application={application}
      locale={locale}
      onConfirm={onConfirm}
      state={state}
    />
  );
}
