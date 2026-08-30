import type { AppAction, AvailableApp } from "../native-bridge/types";

export function UnknownAction({
  action,
  application,
  message,
}: {
  action?: AppAction;
  application: AvailableApp;
  message: string;
}) {
  return (
    <p className="unknown-action" role="alert">
      {message} <code>{action?.id ?? application.activeActionId}</code>
    </p>
  );
}
