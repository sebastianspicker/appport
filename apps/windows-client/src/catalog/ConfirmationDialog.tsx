import { copyFor, type Locale } from "../i18n/copy";
import type { AvailableApp } from "../native-bridge/types";
import { useModalDialog } from "../ui/useModalDialog";
import { Icon } from "../ui/Icon";

export function ConfirmationDialog({
  application,
  deviceName,
  locale,
  returnFocus,
  onCancel,
  onConfirm,
}: {
  application: AvailableApp;
  deviceName: string;
  locale: Locale;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = copyFor(locale);
  const dialogRef = useModalDialog(returnFocus);
  const intent = application.installedVersionId
    ? copy.confirmUpdate
    : copy.confirmInstall;
  return (
    <dialog
      ref={dialogRef}
      className="confirmation"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-warning"
    >
      <h2 id="confirmation-title">
        {copy.confirmAction.replace("{intent}", intent)}
      </h2>
      <dl>
        <div>
          <dt>App</dt>
          <dd>{application.name}</dd>
        </div>
        <div>
          <dt>{copy.targetVersion}</dt>
          <dd>{application.releasedVersionLabel ?? copy.available}</dd>
        </div>
        <div>
          <dt>{copy.forDevice}</dt>
          <dd>{deviceName}</dd>
        </div>
      </dl>
      <p id="confirmation-warning" className="unknown-action">
        <Icon name="warning" size={16} />
        {copy.confirmationWarning}
      </p>
      <div className="dialog-actions">
        <button className="secondary" autoFocus onClick={onCancel}>
          {copy.cancel}
        </button>
        <button className="primary" onClick={onConfirm}>
          {copy.confirm}
        </button>
      </div>
    </dialog>
  );
}
