import { text, type Locale } from "./appCopy";
import { ActionStatus } from "./ActionStatus";
import type { AppAction, AvailableApp } from "./models";
import { UnknownAction } from "./UnknownAction";

export function ActionSummary({ action, application, locale, state }: { action?: AppAction; application: AvailableApp; locale: Locale; state: string | null | undefined }) {
  const copy = text[locale];
  if (state === "unknown") return <UnknownAction action={action} application={application} message={copy.unknownAction} />;
  return <ActionStatus label={state ?? application.releasedVersionLabel ?? copy.available} state={state} status={copy.status} />;
}
