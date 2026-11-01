import { copyFor, type Locale } from "../i18n/copy";
import type { ConfirmationHandler } from "./confirmation";
import type { ActionState, AvailableApp } from "../native-bridge/types";
import { isRetryable } from "./actionState";
import { Icon } from "../ui/Icon";

export function ActionButton({
  application,
  locale,
  onConfirm,
  state,
}: {
  application: AvailableApp;
  locale: Locale;
  onConfirm: ConfirmationHandler;
  state: ActionState | null | undefined;
}) {
  const copy = copyFor(locale);
  return (
    <button
      className="action-button primary"
      onClick={(event) => {
        onConfirm({ application, opener: event.currentTarget });
      }}
    >
      {actionLabel(
        application,
        state,
        copy.retryAction,
        copyFor(locale).reviewUpdate,
        copyFor(locale).reviewInstall,
      )}
      <Icon name="arrow" size={20} />
    </button>
  );
}

function actionLabel(
  application: AvailableApp,
  state: ActionState | null | undefined,
  retry: string,
  update: string,
  install: string,
) {
  if (isRetryable(state)) return retry;
  return application.installedVersionId ? update : install;
}
