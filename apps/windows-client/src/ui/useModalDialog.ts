import { useEffect, useRef } from "react";

/** Uses the browser top layer so background controls cannot receive focus. */
export function useModalDialog(opener: HTMLElement | null) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const fallback = opener?.closest<HTMLElement>("[data-focus-return]");
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected && !opener.matches(":disabled")) opener.focus();
      else if (fallback?.isConnected) fallback.focus();
    };
  }, [opener]);
  return dialogRef;
}
