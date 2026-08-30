import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import { AppIcon, resetIconSession } from "./AppIcon";

vi.mock("../native-bridge/native", () => ({ native: { icon: vi.fn() } }));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function icon(appId: string, hasIcon = true) {
  return (
    <AppIcon appId={appId} hasIcon={hasIcon} name="Firefox" sessionKey={1} />
  );
}

beforeEach(() => {
  resetIconSession();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  resetIconSession();
});

describe("AppIcon", () => {
  it("renders the fallback initially and after icon availability changes", async () => {
    vi.mocked(native.icon).mockResolvedValue("data:image/png;base64,AA==");
    const view = render(icon("firefox"));
    expect(view.container.querySelector(".app-icon")?.textContent).toBe("F");
    await waitFor(() =>
      expect(view.container.querySelector(".app-icon")?.className).toBe(
        "app-icon",
      ),
    );
    view.rerender(icon("firefox", false));
    expect(view.container.querySelector(".app-icon")?.className).toBe(
      "app-icon placeholder",
    );
  });

  it("limits concurrent icon requests to four", async () => {
    const requests = Array.from({ length: 5 }, () => deferred<string | null>());
    let next = 0;
    vi.mocked(native.icon).mockImplementation(() => requests[next++].promise);
    const view = render(
      <>{Array.from({ length: 5 }, (_, index) => icon(`icon-${index}`))}</>,
    );
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(4));
    requests[0].resolve(null);
    await act(async () => {
      await requests[0].promise;
    });
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(5));
    requests.slice(1).forEach((request) => request.resolve(null));
    view.unmount();
  });

  it("does not start queued icon loads after session reset", async () => {
    const requests = Array.from({ length: 5 }, () => deferred<string | null>());
    let next = 0;
    vi.mocked(native.icon).mockImplementation(() => requests[next++].promise);
    const view = render(
      <>{Array.from({ length: 5 }, (_, index) => icon(`queued-${index}`))}</>,
    );
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(4));
    resetIconSession();
    requests.slice(0, 4).forEach((request) => request.resolve(null));
    await act(async () => {
      await Promise.all(requests.slice(0, 4).map(({ promise }) => promise));
    });
    expect(native.icon).toHaveBeenCalledTimes(4);
    view.unmount();
  });

  it("clears cached icons when the authenticated session resets", async () => {
    vi.mocked(native.icon).mockResolvedValue("data:image/png;base64,first");
    const first = render(icon("cached"));
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(1));
    first.unmount();
    resetIconSession();
    render(icon("cached"));
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(2));
  });
});
