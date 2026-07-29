const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function handleDialogKeyDown(
  event: KeyboardEvent,
  dialog: HTMLElement | null,
  onCancel: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key === "Tab") trapTab(event, dialog);
}

function trapTab(event: KeyboardEvent, dialog: HTMLElement | null) {
  const controls = Array.from(
    dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
  );
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls.at(-1)!;
  const boundary = event.shiftKey ? first : last;
  if (document.activeElement !== boundary) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
