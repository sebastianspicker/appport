import type { AppAction, AvailableApp } from "../native-bridge/types";
import { Icon } from "../ui/Icon";

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
      <Icon name="warning" size={16} />
      <span>
        {message} <code>{action?.id ?? application.activeActionId}</code>
      </span>
    </p>
  );
}
