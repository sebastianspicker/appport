import { copyFor, type Locale } from "./appCopy";
import { AppIcon } from "./AppIcon";
import { AppActionState } from "./AppActionState";
import type { AppAction, AvailableApp } from "./models";
import type { PollingState } from "./useAppCatalog";

export function AppCard({
  application,
  action,
  actionFailure,
  busy,
  iconSession,
  locale,
  onConfirm,
  polling,
  onResume,
}: {
  application: AvailableApp;
  action?: AppAction;
  actionFailure?: string;
  busy: boolean;
  iconSession: number;
  locale: Locale;
  onConfirm: (application: AvailableApp, opener: HTMLElement) => void;
  polling?: PollingState;
  onResume: (appId: string) => void;
}) {
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
      />
    </article>
  );
}
