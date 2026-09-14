import { useEffect, useRef } from "react";
import type { copyForBrowser } from "./copy";
import type { DemoApplication } from "./data";

export function DemoConfirmationDialog({
  application,
  copy,
  onCancel,
  onConfirm,
  returnFocus,
}: {
  application: DemoApplication;
  copy: ReturnType<typeof copyForBrowser>;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocus: HTMLButtonElement;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      returnFocus.focus();
    };
  }, [returnFocus]);
  return (
    <dialog
      aria-describedby="demo-confirm-description"
      aria-labelledby="demo-confirm-title"
      className="confirmation"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialogRef}
    >
      <h2 id="demo-confirm-title">{copy.confirmTitle}</h2>
      <p id="demo-confirm-description">
        <strong>{application.name}</strong> · {copy.confirmText}
      </p>
      <div className="dialog-actions">
        <button className="secondary" onClick={onCancel} ref={cancelRef}>
          {copy.cancel}
        </button>
        <button className="primary" onClick={onConfirm}>
          {copy.confirm}
        </button>
      </div>
    </dialog>
  );
}
