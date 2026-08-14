import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppIcon, resetIconSession } from "./AppIcon";
import { native } from "./native";

vi.mock("./native", () => ({
  native: {
    icon: vi.fn(),
  },
}));

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
  it("renders the fallback initially and after hasIcon changes to false", async () => {
    vi.mocked(native.icon).mockResolvedValue("data:image/png;base64,AA==");
    const view = render(icon("firefox"));

    expect(view.container.querySelector(".app-icon")?.textContent).toBe("F");
    await waitFor(() => {
      expect(view.container.querySelector(".app-icon")?.className).toBe(
        "app-icon",
      );
    });

    view.rerender(icon("firefox", false));

    expect(view.container.querySelector(".app-icon")?.className).toBe(
      "app-icon placeholder",
    );
    expect(view.container.querySelector(".app-icon")?.textContent).toBe("F");
  });

  it("limits icon requests to four concurrent loads", async () => {
    const requests = Array.from({ length: 5 }, () => deferred<string | null>());
    let nextRequest = 0;
    vi.mocked(native.icon).mockImplementation(
      () => requests[nextRequest++].promise,
    );
    const view = render(
      <>
        {Array.from({ length: 5 }, (_, index) => icon(`concurrent-${index}`))}
      </>,
    );

    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(4));
    requests[0].resolve(null);
    await act(async () => {
      await requests[0].promise;
    });
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(5));

    for (const request of requests.slice(1)) request.resolve(null);
    await act(async () => {
      await Promise.all(requests.slice(1).map(({ promise }) => promise));
    });
    view.unmount();
  });

  it("does not start queued requests after the icon session is reset", async () => {
    const requests = Array.from({ length: 5 }, () => deferred<string | null>());
    let nextRequest = 0;
    vi.mocked(native.icon).mockImplementation(
      () => requests[nextRequest++].promise,
    );
    const view = render(
      <>{Array.from({ length: 5 }, (_, index) => icon(`queued-${index}`))}</>,
    );

    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(4));
    resetIconSession();
    for (const request of requests.slice(0, 4)) request.resolve(null);
    await act(async () => {
      await Promise.all(requests.slice(0, 4).map(({ promise }) => promise));
    });

    expect(native.icon).toHaveBeenCalledTimes(4);
    view.unmount();
  });

  it("uses cached icons until the authenticated session is reset", async () => {
    vi.mocked(native.icon)
      .mockResolvedValueOnce("data:image/png;base64,first")
      .mockResolvedValueOnce("data:image/png;base64,second");
    const first = render(icon("cached"));
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(1));
    first.unmount();

    const cached = render(icon("cached"));
    await waitFor(() =>
      expect(cached.container.querySelector(".app-icon")?.className).toBe(
        "app-icon",
      ),
    );
    expect(native.icon).toHaveBeenCalledTimes(1);
    cached.unmount();

    resetIconSession();
    const fresh = render(icon("cached"));
    await waitFor(() => expect(native.icon).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(fresh.container.querySelector(".app-icon")?.className).toBe(
        "app-icon",
      ),
    );
  });
});
