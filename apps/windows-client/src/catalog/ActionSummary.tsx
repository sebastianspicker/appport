import { copyFor, type Locale } from "../i18n/copy";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import { Icon } from "../ui/Icon";
import { ActionStatus } from "./ActionStatus";
import type { PollingState } from "./model";
import { UnknownAction } from "./UnknownAction";

type ActionSummaryProps = {
  action?: AppAction;
  application: AvailableApp;
  locale: Locale;
  polling?: PollingState;
  state: string | null | undefined;
};

export function ActionSummary({
  action,
  application,
  locale,
  polling,
  state,
}: ActionSummaryProps) {
  const copy = copyFor(locale);
  if (state === "unknown")
    return (
      <UnknownAction
        action={action}
        application={application}
        message={copy.unknownAction}
      />
    );
  if (polling === "paused" && action)
    return <PausedAction action={action} label={copy.pollingPaused} />;
  if (polling === "polling" && action)
    return (
      <PollingAction
        action={action}
        application={application}
        locale={locale}
      />
    );
  if (state)
    return (
      <ResolvedAction
        action={action}
        locale={locale}
        state={state}
        status={copy.status}
      />
    );
  return <VersionRail application={application} locale={locale} />;
}

function PausedAction({ action, label }: { action: AppAction; label: string }) {
  return (
    <p className="action-paused status-note" role="status">
      {label} <code>{action.id}</code>
    </p>
  );
}

function PollingAction({
  action,
  application,
  locale,
}: {
  action: AppAction;
  application: AvailableApp;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  const reached = trackPosition(action.state);
  const stages = [
    copy.trackRequested,
    copy.trackSent,
    copy.trackVerifying,
    copy.trackConfirmed,
  ];
  return (
    <div className="action-polling status-line" role="status">
      <span className="status-pill working">
        <Icon name="updates" size={14} />
        {actionStateLabel(action.state, action.intent, locale)}
      </span>
      <span
        aria-label={`${copy.polling} ${application.name}`}
        className="request-track"
        aria-valuetext={stages[reached]}
        role="progressbar"
      >
        {stages.map((step, index) => (
          <i
            key={step}
            className={
              index < reached ? "done" : index === reached ? "current" : ""
            }
          >
            <span className="track-label">{step}</span>
          </i>
        ))}
      </span>
      <small>
        {copy.status}: <code>{action.id}</code>
      </small>
    </div>
  );
}

/** Places a polled state on the four-stage request track. */
function trackPosition(state: AppAction["state"]) {
  if (state === "queued") return 0;
  if (state === "sent" || state === "deferred") return 1;
  if (state === "verifying") return 2;
  return 3;
}

function ResolvedAction({
  action,
  locale,
  state,
  status,
}: {
  action?: AppAction;
  locale: Locale;
  state: string;
  status: string;
}) {
  const label = actionStateLabel(state, action?.intent, locale);
  if (!isFailureWithMessage(state, action))
    return <ActionStatus label={label} state={state} status={status} />;
  return (
    <div className="status-line">
      <ActionStatus label={label} state={state} status={status} />
      <p className="inline-error" role="alert">
        <Icon name="error" size={16} />
        {action.errorMessage}
      </p>
    </div>
  );
}

function isFailureWithMessage(
  state: string,
  action: AppAction | undefined,
): action is AppAction & { errorMessage: string } {
  return (
    (state === "failed" || state === "cancelled") &&
    Boolean(action?.errorMessage)
  );
}

function actionStateLabel(
  state: string,
  intent: AppAction["intent"] | undefined,
  locale: Locale,
) {
  const copy = copyFor(locale);
  const labels: Record<string, string> = {
    queued: copy.actionQueued,
    sent: copy.actionSent,
    deferred: copy.actionDeferred,
    succeeded: copy.actionSucceeded,
    failed: copy.actionFailed,
    cancelled: copy.actionCancelled,
  };
  if (state === "verifying")
    return intent === "update"
      ? copy.actionVerifyingUpdate
      : copy.actionVerifyingInstall;
  return labels[state] ?? state;
}

function VersionRail({
  application,
  locale,
}: {
  application: AvailableApp;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  const target = application.releasedVersionLabel ?? copy.available;
  const label = application.installedVersionLabel
    ? `${copy.installedVersion}: ${application.installedVersionLabel}. ${copy.availableVersion}: ${target}.`
    : `${copy.availableVersion}: ${target}.`;
  return (
    <div className="version-rail" aria-label={label}>
      <span className="version-label plate-label">{copy.version}</span>
      {application.installedVersionLabel && (
        <>
          <span className="version-from">
            {application.installedVersionLabel}
          </span>
          <span aria-hidden="true">→</span>
        </>
      )}
      <strong
        className={`version-to${application.installedVersionLabel ? " changed" : ""}`}
      >
        {target}
      </strong>
    </div>
  );
}
