import { designCopyFor } from "../i18n/designCopy";
import { copyFor, type Locale } from "../i18n/copy";
import type { ConfirmationHandler } from "./confirmation";
import type { AvailableApp } from "../native-bridge/types";
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
  state: string | null | undefined;
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
        designCopyFor(locale).reviewUpdate,
        designCopyFor(locale).reviewInstall,
      )}
      <Icon name="arrow" size={20} />
    </button>
  );
}

function actionLabel(
  application: AvailableApp,
  state: string | null | undefined,
  retry: string,
  update: string,
  install: string,
) {
  if (state === "failed" || state === "cancelled") return retry;
  return application.installedVersionId ? update : install;
}
