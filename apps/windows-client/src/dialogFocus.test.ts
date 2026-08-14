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
    const dialog = document.createElement("div");
    handleDialogKeyDown(key("Enter"), dialog, cancel);
    handleDialogKeyDown(key("Tab"), dialog, cancel);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("wraps forward Tab from the final control", () => {
    const dialog = document.createElement("div");
    dialog.innerHTML = "<button>First</button><button>Last</button>";
    document.body.append(dialog);
    const controls = dialog.querySelectorAll("button");
    controls[1].focus();
    const event = key("Tab");
    handleDialogKeyDown(event, dialog, vi.fn());
    expect(document.activeElement).toBe(controls[0]);
    expect(event.defaultPrevented).toBe(true);
    dialog.remove();
  });

  it("wraps backward Tab from the first control", () => {
    const dialog = document.createElement("div");
    dialog.innerHTML = "<button>First</button><button>Last</button>";
    document.body.append(dialog);
    const controls = dialog.querySelectorAll("button");
    controls[0].focus();
    const event = key("Tab", true);
    handleDialogKeyDown(event, dialog, vi.fn());
    expect(document.activeElement).toBe(controls[1]);
    expect(event.defaultPrevented).toBe(true);
    dialog.remove();
  });

  it("does not wrap while focus is inside the boundary", () => {
    const dialog = document.createElement("div");
    dialog.innerHTML =
      "<button>First</button><button>Middle</button><button>Last</button>";
    document.body.append(dialog);
    const controls = dialog.querySelectorAll("button");
    controls[1].focus();
    const event = key("Tab");
    handleDialogKeyDown(event, dialog, vi.fn());
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(controls[1]);
    dialog.remove();
  });
});
