import { type Locale } from "./appCopy";
import { ActionControl } from "./ActionControl";
import { ActionSummary } from "./ActionSummary";
import type { AppAction, AvailableApp } from "./models";

export function AppActionState({ application, action, busy, locale, onConfirm }: { application: AvailableApp; action?: AppAction; busy: boolean; locale: Locale; onConfirm: (application: AvailableApp, opener: HTMLElement) => void }) {
  const state = action?.state ?? application.activeActionState;
  return <><ActionSummary action={action} application={application} locale={locale} state={state} /><ActionControl application={application} busy={busy} locale={locale} state={state} onConfirm={onConfirm} /></>;
}
