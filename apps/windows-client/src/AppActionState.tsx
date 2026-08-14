import { type Locale } from "./appCopy";
import { ActionControl } from "./ActionControl";
import { ActionSummary } from "./ActionSummary";
import type { ConfirmationHandler } from "./catalogInteraction";
import type { AppAction, AvailableApp } from "./models";
import type { PollingState, ResumeAction } from "./useAppCatalog";

type AppActionStateProps = {
  application: AvailableApp;
  action?: AppAction;
  busy: boolean;
  locale: Locale;
  onConfirm: ConfirmationHandler;
  polling?: PollingState;
  onResume: ResumeAction;
  writesEnabled: boolean;
};

export function AppActionState(props: AppActionStateProps) {
  const {
    application,
    action,
    busy,
    locale,
    onConfirm,
    polling,
    onResume,
    writesEnabled,
  } = props;
  const state = action?.state ?? application.activeActionState;
  return (
    <>
      <ActionSummary
        action={action}
        application={application}
        locale={locale}
        polling={polling}
        state={state}
      />
      <ActionControl
        application={application}
        busy={busy}
        locale={locale}
        state={state}
        onConfirm={onConfirm}
        polling={polling}
        onResume={onResume}
        writesEnabled={writesEnabled}
      />
    </>
  );
}
