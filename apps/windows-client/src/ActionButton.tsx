import { copyFor, type Locale } from "./appCopy";
import type { AvailableApp } from "./models";

export function ActionButton({
  application,
  locale,
  onConfirm,
  state,
}: {
  application: AvailableApp;
  locale: Locale;
  onConfirm: (application: AvailableApp, opener: HTMLElement) => void;
  state: string | null | undefined;
}) {
  const copy = copyFor(locale);
  return (
    <button
      onClick={(event) => {
        onConfirm(application, event.currentTarget);
      }}
    >
      {actionLabel(
        application,
        state,
        copy.retryAction,
        copy.update,
        copy.install,
      )}
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
