import { text, type Locale } from "./appCopy";
import { ActionStatus } from "./ActionStatus";
import type { AppAction, AvailableApp } from "./models";
import { UnknownAction } from "./UnknownAction";
import type { PollingState } from "./useAppCatalog";

export function ActionSummary({
  action,
  application,
  locale,
  polling,
  state,
}: {
  action?: AppAction;
  application: AvailableApp;
  locale: Locale;
  polling?: PollingState;
  state: string | null | undefined;
}) {
  const copy = text[locale];
  if (state === "unknown")
    return (
      <UnknownAction
        action={action}
        application={application}
        message={copy.unknownAction}
      />
    );
  if (polling === "paused" && action)
    return (
      <p className="action-paused" role="status">
        {copy.pollingPaused} <code>{action.id}</code>
      </p>
    );
  if (polling === "polling" && action)
    return (
      <p className="action-polling" role="status">
        {copy.polling} <code>{action.id}</code>
      </p>
    );
  if (state)
    return <ActionStatus label={state} state={state} status={copy.status} />;
  const target = application.releasedVersionLabel ?? copy.available;
  const label = application.installedVersionLabel
    ? `${copy.installedVersion}: ${application.installedVersionLabel}. ${copy.availableVersion}: ${target}.`
    : `${copy.availableVersion}: ${target}.`;
  return (
    <div className="version-rail" aria-label={label}>
      {application.installedVersionLabel && (
        <>
          <span>{application.installedVersionLabel}</span>
          <span aria-hidden="true">→</span>
        </>
      )}
      <strong>{target}</strong>
    </div>
  );
}
