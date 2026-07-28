import { text, type Locale } from "./appCopy";
import { AppIcon } from "./AppIcon";
import { AppActionState } from "./AppActionState";
import type { AppAction, AvailableApp, InstalledApplication } from "./models";

export function AppCard({ application, action, busy, locale, onConfirm }: { application: AvailableApp; action?: AppAction; busy: boolean; locale: Locale; onConfirm: (application: AvailableApp, opener: HTMLElement) => void }) {
  const copy = text[locale];
  return <article className="card"><div className="card-heading"><AppIcon appId={application.id} name={application.name} /><div><p className="eyebrow">{application.publisher ?? copy.approved}</p><h2>{application.name}</h2></div></div><p>{application.description ?? copy.approvedForDevice}</p><AppActionState application={application} action={action} busy={busy} locale={locale} onConfirm={onConfirm} /></article>;
}

export function InstalledCard({ application, locale }: { application: InstalledApplication; locale: Locale }) {
  const copy = text[locale];
  return <article className="card"><div className="card-heading">{application.appId && <AppIcon appId={application.appId} name={application.name} />}<h2>{application.name}</h2></div><p>{application.version}</p><small>{application.updateAvailable ? copy.updateAvailable : copy.installed}</small></article>;
}
