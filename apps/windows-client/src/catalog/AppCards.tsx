import { copyFor, type Locale } from "../i18n/copy";
import { AppIcon } from "./AppIcon";
import { AppActionState } from "./AppActionState";
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
  locale: Locale;
  onConfirm: ConfirmationHandler;
  polling?: PollingState;
  onResume: ResumeAction;
  writesEnabled: boolean;
};

export function AppCard(props: AppCardProps) {
  const {
    application,
    action,
    actionFailure,
    busy,
    iconSession,
    locale,
    onConfirm,
    polling,
    onResume,
    writesEnabled,
  } = props;
  const copy = copyFor(locale);
  return (
    <article className="card">
      <div className="card-heading">
        <AppIcon
          appId={application.id}
          hasIcon={application.hasIcon}
          name={application.name}
          sessionKey={iconSession}
        />
        <div>
          <p className="eyebrow">{application.publisher ?? copy.approved}</p>
          <h2>{application.name}</h2>
        </div>
      </div>
      <p>{application.description ?? copy.approvedForDevice}</p>
      {actionFailure && <p role="alert">{actionFailure}</p>}
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
    </article>
  );
}
