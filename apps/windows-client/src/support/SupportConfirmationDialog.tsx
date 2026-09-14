import type { Copy } from "../i18n/copy";
import type { SupportDetails } from "../native-bridge/types";
import { useModalDialog } from "../ui/useModalDialog";
import { SupportConfirmationDetails } from "./SupportDetails";

export function SupportConfirmationDialog({
  copy,
  details,
  onClose,
  onConfirm,
  opener,
}: {
  copy: Copy;
  details: SupportDetails;
  onClose: () => void;
  onConfirm: () => void;
  opener: HTMLElement | null;
}) {
  const dialogRef = useModalDialog(opener);
  return (
    <dialog
      ref={dialogRef}
      className="support-dialog"
      aria-labelledby="support-confirmation-title"
      aria-describedby="support-confirmation-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="support-confirmation-title">{copy.supportConfirmTitle}</h2>
      <SupportConfirmationDetails copy={copy} details={details} />
      <p id="support-confirmation-description" className="support-local-note">
        {copy.supportConfirmDescription}
      </p>
      <div className="dialog-actions">
        <button autoFocus className="secondary" onClick={onClose}>
          {copy.cancel}
        </button>
        <button className="primary" onClick={onConfirm}>
          {copy.confirm}
        </button>
      </div>
    </dialog>
  );
}
