import { text, type Copy, type Locale } from "./appCopy";
import { isTerminalActionState } from "./useAppCatalog";
import type { AppAction, AvailableApp } from "./models";

export function AppActionState({ application, action, busy, locale, onConfirm }: { application: AvailableApp; action?: AppAction; busy: boolean; locale: Locale; onConfirm: (application: AvailableApp, opener: HTMLElement) => void }) {
  const state = action?.state ?? application.activeActionState;
  return <><ActionSummary action={action} application={application} locale={locale} state={state} /><ActionControl application={application} busy={busy} locale={locale} state={state} onConfirm={onConfirm} /></>;
}

function ActionSummary({ action, application, locale, state }: { action?: AppAction; application: AvailableApp; locale: Locale; state: string | null | undefined }) {
  const copy = text[locale];
  if (state === "unknown") return <p className="unknown-action" role="alert">{copy.unknownAction} <code>{action?.id ?? application.activeActionId}</code></p>;
  return <small>{state ? `${copy.status}: ${state}` : application.releasedVersionLabel ?? copy.available}</small>;
}

function ActionControl({ application, busy, locale, state, onConfirm }: { application: AvailableApp; busy: boolean; locale: Locale; state: string | null | undefined; onConfirm: (application: AvailableApp, opener: HTMLElement) => void }) {
  const copy = text[locale];
  if (application.installState === "installed" || state === "unknown") return null;
  if (busy) return <button disabled>{copy.starting}</button>;
  if (state && !isTerminalActionState(state)) return <button disabled>{copy.starting}</button>;
  return <button onClick={(event) => onConfirm(application, event.currentTarget)}>{actionLabel(application, state, copy)}</button>;
}

function actionLabel(application: AvailableApp, state: string | null | undefined, copy: Copy) {
  if (state === "failed" || state === "cancelled") return copy.retryAction;
  return application.installedVersionId ? copy.update : copy.install;
}
