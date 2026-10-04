import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import { AppIcon, resetIconSession } from "./AppIcon";
import { setIconCatalogRevision } from "./iconPool";
import { deferred } from "../testing/nativeMock";

vi.mock("../native-bridge/native", () => ({ native: { icon: vi.fn() } }));
const observers = new Map<Element, IntersectionObserverCallback>();
const observeOptions = vi.fn();
class Observer {
  constructor(
    private callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) {
    observeOptions(options);
  }
  observe(target: Element) {
    observers.set(target, this.callback);
  }
  disconnect() {
    for (const [target, callback] of observers)
      if (callback === this.callback) observers.delete(target);
  }
}
function visible(target: Element, isIntersecting = true) {
  act(() =>
    observers.get(target)?.(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
}
function allVisible(container: HTMLElement) {
  for (const target of container.querySelectorAll(".app-icon")) visible(target);
}
function icon(appId: string, hasIcon = true, catalogRevision = "icons-1") {
  return (
    <AppIcon
      key={appId}
      appId={appId}
      hasIcon={hasIcon}
      name="Firefox"
      sessionKey={1}
      catalogRevision={catalogRevision}
    />
  );
}
beforeEach(() => {
  resetIconSession();
  setIconCatalogRevision("icons-1");
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => {
  cleanup();
  resetIconSession();
  observers.clear();
  vi.unstubAllGlobals();
});

describe("AppIcon", () => {
  it("requests icons only within the viewport margin and releases offscreen images", async () => {
    vi.mocked(native.icon).mockResolvedValue("data:image/png;base64,AA==");
    const view = render(icon("firefox"));
    const target = view.container.querySelector(".app-icon")!;
    expect(native.icon).not.toHaveBeenCalled();
    expect(observeOptions).toHaveBeenCalledWith({ rootMargin: "200px" });
    visible(target);
    await waitFor(() => expect(target.className).toBe("app-icon"));
    expect(native.icon).toHaveBeenCalledWith("firefox", "icons-1");
    visible(target, false);
    expect(target.getAttribute("style")).toBe("");
    expect(target.textContent).toBe("F");
    visible(target);
    expect(native.icon).toHaveBeenCalledTimes(1);
    expect(target.className).toBe("app-icon");
    view.rerender(icon("firefox", false));
    expect(target.className).toBe("app-icon placeholder");
  });

  it("coalesces duplicate subscriptions and cancels queued offscreen loads", async () => {
    const pending = deferred<string | null>();
    vi.mocked(native.icon).mockReturnValue(pending.promise);
    const view = render(
      <>
        {[0, 1, 2, 3, 4].map((index) => icon(`icon-${index}`))}
        <AppIcon
          appId="icon-0"
          hasIcon
          name="Duplicate"
          sessionKey={1}
          catalogRevision="icons-1"
        />
      </>,
    );
    allVisible(view.container);
    expect(native.icon).toHaveBeenCalledTimes(4);
    visible(view.container.querySelectorAll(".app-icon")[4], false);
    await act(async () => {
      pending.resolve(null);
      await pending.promise;
    });
    expect(native.icon).toHaveBeenCalledTimes(4);
  });

  it("does not start queued icon loads after session reset", async () => {
    const pending = deferred<string | null>();
    vi.mocked(native.icon).mockReturnValue(pending.promise);
    const view = render(
      <>{[0, 1, 2, 3, 4].map((index) => icon(`queued-${index}`))}</>,
    );
    allVisible(view.container);
    expect(native.icon).toHaveBeenCalledTimes(4);
    resetIconSession();
    await act(async () => {
      pending.resolve(null);
      await pending.promise;
    });
    expect(native.icon).toHaveBeenCalledTimes(4);
  });

  it("discards a previous revision in flight and requests the new revision", async () => {
    const pending = deferred<string | null>();
    vi.mocked(native.icon)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue("data:image/png;base64,new");
    const first = render(icon("cached"));
    allVisible(first.container);
    act(() => setIconCatalogRevision("icons-2"));
    first.rerender(icon("cached", true, "icons-2"));
    allVisible(first.container);
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(2));
    await act(async () => {
      pending.resolve("data:image/png;base64,old");
      await pending.promise;
    });
    expect(
      first.container.querySelector(".app-icon")?.getAttribute("style"),
    ).toContain("new");
  });
});
