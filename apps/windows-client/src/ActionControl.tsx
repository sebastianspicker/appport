import { text, type Locale } from "./appCopy";
import { ActionButton } from "./ActionButton";
import { isTerminalActionState } from "./useAppCatalog";
import type { AvailableApp } from "./models";

export function ActionControl({ application, busy, locale, state, onConfirm }: { application: AvailableApp; busy: boolean; locale: Locale; state: string | null | undefined; onConfirm: (application: AvailableApp, opener: HTMLElement) => void }) {
  const copy = text[locale];
  if (application.installState === "installed" || state === "unknown") return null;
  if (busy || (state && !isTerminalActionState(state))) return <button disabled>{copy.starting}</button>;
  return <ActionButton application={application} locale={locale} onConfirm={onConfirm} state={state} />;
}
