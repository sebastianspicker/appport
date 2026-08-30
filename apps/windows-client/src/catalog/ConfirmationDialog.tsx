import { useEffect, useRef } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import type { AvailableApp } from "../native-bridge/types";
import { handleDialogKeyDown } from "../ui/dialogFocus";

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
  const dialogRef = useRef<HTMLElement>(null);
  const intent = application.installedVersionId
    ? copy.confirmUpdate
    : copy.confirmInstall;
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      handleDialogKeyDown(event, dialogRef.current, onCancel);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, [onCancel, returnFocus]);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="confirmation"
        role="dialog"
        aria-modal="true"
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
          {copy.confirmationWarning}
        </p>
        <div className="dialog-actions">
          <button className="secondary" autoFocus onClick={onCancel}>
            {copy.cancel}
          </button>
          <button onClick={onConfirm}>{copy.confirm}</button>
        </div>
      </section>
    </div>
  );
}
