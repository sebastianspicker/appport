import { type Locale } from "./appCopy";
import { ActionControl } from "./ActionControl";
import { ActionSummary } from "./ActionSummary";
import type { AppAction, AvailableApp } from "./models";
import type { PollingState } from "./useAppCatalog";

export function AppActionState({
  application,
  action,
  busy,
  locale,
  onConfirm,
  polling,
  onResume,
}: {
  application: AvailableApp;
  action?: AppAction;
  busy: boolean;
  locale: Locale;
  onConfirm: (application: AvailableApp, opener: HTMLElement) => void;
  polling?: PollingState;
  onResume: (appId: string) => void;
}) {
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
      />
    </>
  );
}
