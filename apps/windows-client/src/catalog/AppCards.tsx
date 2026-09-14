import { useId, useState } from "react";
import { designCopyFor } from "../i18n/designCopy";
import { copyFor, type Locale } from "../i18n/copy";
import { AppIcon } from "./AppIcon";
import { AppActionState } from "./AppActionState";
import { Icon } from "../ui/Icon";
import type { ConfirmationHandler } from "./confirmation";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import type { PollingState } from "./types";
import type { ResumeAction } from "./useCatalogActions";

type AppCardProps = {
  application: AvailableApp;
  action?: AppAction;
  actionFailure?: string;
  busy: boolean;
  iconSession: number;
  catalogRevision: string;
  locale: Locale;
  onConfirm: ConfirmationHandler;
  polling?: PollingState;
  onResume: ResumeAction;
  writesEnabled: boolean;
  deviceName: string;
};

export function AppCard(props: AppCardProps) {
  const {
    application,
    action,
    actionFailure,
    busy,
    iconSession,
    catalogRevision,
    locale,
    onConfirm,
    polling,
    onResume,
    writesEnabled,
  } = props;
  const copy = copyFor(locale);
  const design = designCopyFor(locale);
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  return (
    <article
      className={`card${expanded ? " selected" : ""}`}
      tabIndex={-1}
      data-focus-return
      aria-label={application.name}
    >
      <div className="app-identity">
        <AppIcon
          key={`${iconSession}:${catalogRevision}:${application.hasIcon}`}
          appId={application.id}
          hasIcon={application.hasIcon}
          name={application.name}
          sessionKey={iconSession}
          catalogRevision={catalogRevision}
        />
        <div className="card-identity">
          <h2>{application.name}</h2>
          <p className="app-publisher">
            {application.publisher ?? copy.approved}
            <span className="source-chip">
              {sourceLabel(application.source)}
            </span>
          </p>
          <p className="app-description">
            {application.description ?? copy.approvedForDevice}
          </p>
        </div>
      </div>
      {actionFailure && (
        <p className="inline-error" role="alert">
          <Icon name="error" size={16} />
          {actionFailure}
        </p>
      )}
      <div className="row-version">
        {application.installedVersionLabel && (
          <span>{application.installedVersionLabel} → </span>
        )}
        {application.releasedVersionLabel ?? copy.available}
      </div>
      <button
        className="view-button"
        data-application-id={application.id}
        aria-expanded={expanded || hasPendingState(props)}
        aria-controls={detailId}
        onClick={() => setExpanded(!expanded)}
      >
        {design.view}
        <Icon name="arrow" size={20} />
      </button>
      <div
        id={detailId}
        className="app-details"
        hidden={!expanded && !hasPendingState(props)}
      >
        <div>
          <h3>{application.name}</h3>
          <p>{application.description ?? copy.approvedForDevice}</p>
        </div>
        <dl>
          <dt>{copy.forDevice}</dt>
          <dd>{props.deviceName}</dd>
        </dl>
        <div className="app-action">
          <AppActionState
            application={application}
            action={action}
            busy={busy}
            locale={locale}
            onConfirm={onConfirm}
            polling={polling}
            onResume={onResume}
            writesEnabled={writesEnabled}
          />
        </div>
      </div>
    </article>
  );
}

function sourceLabel(source: AvailableApp["source"]) {
  return source === "windows_msi"
    ? "MSI"
    : source === "windows_exe"
      ? "EXE"
      : "Winget";
}

function hasPendingState(props: AppCardProps) {
  return Boolean(
    props.action || props.application.activeActionState || props.busy,
  );
}
