import { describe, expect, it, vi } from "vitest";
import { handleDialogKeyDown } from "./dialogFocus";

function key(key: string, shiftKey = false) {
  return new KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
}

describe("dialog keyboard focus", () => {
  it("cancels on Escape", () => {
    const cancel = vi.fn();
    const event = key("Escape");
    handleDialogKeyDown(event, null, cancel);
    expect(cancel).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores unrelated keys and empty dialogs", () => {
    const cancel = vi.fn();
    handleDialogKeyDown(key("Enter"), document.createElement("div"), cancel);
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([
    [false, 1, 0],
    [true, 0, 1],
  ])(
    "wraps Tab at a dialog boundary",
    (shiftKey, focusIndex, expectedIndex) => {
      const dialog = document.createElement("div");
      dialog.innerHTML = "<button>First</button><button>Last</button>";
      document.body.append(dialog);
      const controls = dialog.querySelectorAll("button");
      controls[focusIndex].focus();
      const event = key("Tab", shiftKey);
      handleDialogKeyDown(event, dialog, vi.fn());
      expect(document.activeElement).toBe(controls[expectedIndex]);
      expect(event.defaultPrevented).toBe(true);
      dialog.remove();
    },
  );
});
