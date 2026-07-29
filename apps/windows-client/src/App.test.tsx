import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { native } from "./native";

vi.mock("./native", () => ({
  native: {
    initialView: vi.fn().mockResolvedValue("apps"),
    connect: vi.fn(),
    bootstrap: vi.fn().mockResolvedValue({
      user: { displayName: "Ada" },
      device: { name: "PC", status: "COMPLIANT", lastSeenAt: null },
      updates: { count: 0, keys: [] },
    }),
    apps: vi.fn().mockResolvedValue([]),
    act: vi.fn(),
    action: vi.fn(),
    icon: vi.fn().mockResolvedValue(null),
    signOut: vi.fn(),
    openRelutionPortal: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.initialView).mockResolvedValue("apps");
  vi.mocked(native.apps).mockResolvedValue([]);
  vi.mocked(native.signOut).mockResolvedValue({
    tokenRevocationRequired: false,
    credentialRemoved: true,
    scheduledTaskRemoved: true,
    notificationStateCleared: true,
  });
});

afterEach(() => vi.useRealTimers());

function application(id: string, name = id) {
  return {
    id,
    name,
    description: null,
    publisher: null,
    source: "winget" as const,
    packageIdentifier: null,
    releasedVersionId: "release",
    releasedVersionLabel: "128",
    installedVersionId: null,
    installedVersionLabel: null,
    installState: "available" as const,
    activeActionId: null,
    activeActionState: null,
    hasIcon: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function submitConnection(username = "ada", token = "secret-token") {
  fireEvent.change(screen.getByLabelText("Relution username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText("Personal access token"), {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
}

function action(state: "queued" | "verifying" | "succeeded" | "unknown") {
  return {
    id: "action-42",
    appId: "firefox",
    deviceId: "device",
    intent: "install" as const,
    state,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

describe("App", () => {
  it("states that an empty catalog is not an error", async () => {
    render(<App />);
    expect(await screen.findByText("Nothing to show")).toBeTruthy();
    expect(screen.getByText("For this device")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Available" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Updates" })).toBeTruthy();
  });

  it("opens only the native fixed Relution portal command", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Manage token in Relution" }),
    );
    expect(native.openRelutionPortal).toHaveBeenCalledWith();
  });

  it("distinguishes no search results from loading", async () => {
    vi.mocked(native.apps).mockResolvedValue([
      {
        id: "firefox",
        name: "Mozilla Firefox",
        description: "Managed browser",
        publisher: "Mozilla",
        source: "winget",
        packageIdentifier: "Mozilla.Firefox",
        releasedVersionId: "release",
        releasedVersionLabel: "128",
        installedVersionId: null,
        installedVersionLabel: null,
        installState: "available",
        activeActionId: null,
        activeActionState: null,
        hasIcon: false,
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Mozilla Firefox")).toBeTruthy();
    expect(screen.getByLabelText("Available version: 128.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search approved software"), {
      target: { value: "does not exist" },
    });
    expect(
      screen.getByText("No approved software matches your search."),
    ).toBeTruthy();
    expect(screen.queryByText("Loading this device")).toBeNull();
  });

  it("shows installed to available versions for updates", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.apps).mockResolvedValue([
      {
        id: "firefox",
        name: "Mozilla Firefox",
        description: null,
        publisher: null,
        source: "winget",
        packageIdentifier: null,
        releasedVersionId: "release",
        releasedVersionLabel: "128.0.4",
        installedVersionId: "installed",
        installedVersionLabel: "128.0.3",
        installState: "update_available",
        activeActionId: null,
        activeActionState: null,
        hasIcon: false,
      },
    ]);
    render(<App />);
    expect(
      await screen.findByLabelText(
        "Installed version: 128.0.3. Available version: 128.0.4.",
      ),
    ).toBeTruthy();
  });

  it("requires a focused cancellation before an install", async () => {
    vi.mocked(native.apps).mockResolvedValue([
      {
        id: "firefox",
        name: "Mozilla Firefox",
        description: null,
        publisher: null,
        source: "winget",
        packageIdentifier: null,
        releasedVersionId: "release",
        releasedVersionLabel: "128",
        installedVersionId: null,
        installedVersionLabel: null,
        installState: "available",
        activeActionId: null,
        activeActionState: null,
        hasIcon: false,
      },
    ]);
    render(<App />);
    const install = await screen.findByRole("button", { name: "Install" });
    install.focus();
    fireEvent.click(install);
    expect(screen.getByRole("dialog").textContent).toContain("Mozilla Firefox");
    expect(screen.getByRole("dialog").textContent).toContain("128");
    expect(screen.getByRole("dialog").textContent).toContain(
      "After confirmation, the result may be temporarily unknown.",
    );
    expect(screen.getByRole("dialog").textContent).not.toContain(
      "Give this action ID to IT:",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(native.act).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(install);
  });

  it("directs the user to revoke a locally removed token in Relution", async () => {
    vi.mocked(native.signOut).mockResolvedValue({
      tokenRevocationRequired: true,
      credentialRemoved: true,
      scheduledTaskRemoved: true,
      notificationStateCleared: true,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText(
        "Signed out locally. Revoke the token in your Relution profile if it is no longer needed; some background cleanup did not complete.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("does not claim local sign-out when native cleanup could not run", async () => {
    vi.mocked(native.signOut).mockRejectedValue(new Error("IPC unavailable"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText(
        "Sign-out could not run. Your stored credential may still be present. Try again or contact IT.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("retains authenticated state when credential deletion fails", async () => {
    vi.mocked(native.signOut).mockResolvedValue({
      tokenRevocationRequired: false,
      credentialRemoved: false,
      scheduledTaskRemoved: true,
      notificationStateCleared: true,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText(
        "Sign-out is incomplete because this device could not delete its stored credential. Contact IT before using this shared device.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("reports background-task cleanup failure after local sign-out", async () => {
    vi.mocked(native.signOut).mockResolvedValue({
      tokenRevocationRequired: false,
      credentialRemoved: true,
      scheduledTaskRemoved: false,
      notificationStateCleared: true,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText(
        "Signed out locally. Revoke the token in your Relution profile if it is no longer needed; some background cleanup did not complete.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("reports notification-state cleanup failure after local sign-out", async () => {
    vi.mocked(native.signOut).mockResolvedValue({
      tokenRevocationRequired: false,
      credentialRemoved: true,
      scheduledTaskRemoved: true,
      notificationStateCleared: false,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText(
        "Signed out locally. Revoke the token in your Relution profile if it is no longer needed; some background cleanup did not complete.",
      ),
    ).toBeTruthy();
  });

  it("warns when a connected session cannot register background checks", async () => {
    vi.mocked(native.connect).mockResolvedValue({
      backgroundCheckRegistered: false,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    submitConnection();
    expect(
      await screen.findByText(
        "Background update checks could not be registered. Keep Appport open to receive update status.",
      ),
    ).toBeTruthy();
  });

  it("clears credentials from the form before connection completes", async () => {
    const pending = deferred<{ backgroundCheckRegistered: boolean }>();
    vi.mocked(native.connect).mockReturnValue(pending.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    submitConnection("ada@example.test", "one-use-secret");

    expect(native.connect).toHaveBeenCalledWith(
      "ada@example.test",
      "one-use-secret",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Relution username").value,
    ).toBe("");
    expect(
      screen.getByLabelText<HTMLInputElement>("Personal access token").value,
    ).toBe("");

    await act(async () => pending.resolve({ backgroundCheckRegistered: true }));
  });

  it("does not let an older Available catalog replace Updates", async () => {
    const available = deferred<ReturnType<typeof application>[]>();
    const updates = deferred<ReturnType<typeof application>[]>();
    vi.mocked(native.apps).mockImplementation((view) =>
      view === "apps" ? available.promise : updates.promise,
    );
    render(<App />);
    await screen.findByRole("button", { name: "Available" });
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    await act(async () => {
      updates.resolve([application("update", "Update result")]);
    });
    expect(await screen.findByText("Update result")).toBeTruthy();
    await act(async () => {
      available.resolve([application("available", "Available result")]);
    });
    expect(screen.queryByText("Available result")).toBeNull();
    expect(screen.getByText("Update result")).toBeTruthy();
  });

  it("pauses polling after a transient failure without inventing an unknown result", async () => {
    vi.useFakeTimers();
    vi.mocked(native.apps).mockResolvedValue([
      application("firefox", "Mozilla Firefox"),
    ]);
    vi.mocked(native.act).mockResolvedValue({
      id: "action-42",
      appId: "firefox",
      deviceId: "device",
      intent: "install",
      state: "queued",
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    vi.mocked(native.action).mockRejectedValue(
      new Error("temporary IPC failure"),
    );
    render(<App />);
    await act(async () => {});
    const install = screen.getByRole("button", { name: "Install" });
    fireEvent.click(install);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText(/Status checks paused/)).toBeTruthy();
    expect(screen.getByText("action-42")).toBeTruthy();
    expect(screen.queryByText(/final result is unknown/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Resume status checks" }),
    ).toBeTruthy();
  });

  it("polls iteratively to a terminal Relution state", async () => {
    vi.useFakeTimers();
    vi.mocked(native.apps).mockResolvedValue([
      application("firefox", "Mozilla Firefox"),
    ]);
    vi.mocked(native.act).mockResolvedValue(action("queued"));
    vi.mocked(native.action)
      .mockResolvedValueOnce(action("verifying"))
      .mockResolvedValueOnce(action("succeeded"));
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(screen.getByText("Status: succeeded")).toBeTruthy();
    expect(native.action).toHaveBeenCalledTimes(2);
    expect(native.apps).toHaveBeenCalledTimes(2);
  });

  it("resumes a paused action and preserves its action identifier", async () => {
    vi.useFakeTimers();
    vi.mocked(native.apps).mockResolvedValue([
      application("firefox", "Mozilla Firefox"),
    ]);
    vi.mocked(native.act).mockResolvedValue(action("queued"));
    vi.mocked(native.action)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(action("succeeded"));
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText("action-42")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Resume status checks" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText("Status: succeeded")).toBeTruthy();
  });

  it("shows unknown only when the Relution workflow returns unknown", async () => {
    vi.useFakeTimers();
    vi.mocked(native.apps).mockResolvedValue([
      application("firefox", "Mozilla Firefox"),
    ]);
    vi.mocked(native.act).mockResolvedValue(action("queued"));
    vi.mocked(native.action).mockResolvedValue(action("unknown"));
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText(/final result is unknown/i)).toBeTruthy();
    expect(screen.getByText("action-42")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Resume status checks" }),
    ).toBeNull();
  });

  it("ignores an in-flight polling result after sign-out", async () => {
    vi.useFakeTimers();
    const refresh = deferred<ReturnType<typeof action>>();
    vi.mocked(native.apps).mockResolvedValue([
      application("firefox", "Mozilla Firefox"),
    ]);
    vi.mocked(native.act).mockResolvedValue(action("queued"));
    vi.mocked(native.action).mockReturnValue(refresh.promise);
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => {
      refresh.resolve(action("succeeded"));
    });
    expect(screen.queryByText("Status: succeeded")).toBeNull();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("keeps action-start failures local to the application card", async () => {
    vi.mocked(native.apps).mockResolvedValue([
      application("firefox", "Mozilla Firefox"),
      application("sevenzip", "7-Zip"),
    ]);
    vi.mocked(native.act).mockRejectedValue({ code: "ACTION" });
    render(<App />);
    await screen.findByText("7-Zip");
    fireEvent.click(screen.getAllByRole("button", { name: "Install" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Action could not be started")).toBeTruthy();
    expect(screen.getByText("7-Zip")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(2);
  });

  it("clears a pending poll timer when the client unmounts", async () => {
    vi.useFakeTimers();
    vi.mocked(native.apps).mockResolvedValue([
      application("firefox", "Mozilla Firefox"),
    ]);
    vi.mocked(native.act).mockResolvedValue({
      id: "action-43",
      appId: "firefox",
      deviceId: "device",
      intent: "install",
      state: "queued",
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    const { unmount } = render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});
    const timerCountWithPoll = vi.getTimerCount();
    expect(timerCountWithPoll).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(timerCountWithPoll - 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(native.action).not.toHaveBeenCalled();
  });

  it("limits icon loading to four concurrent requests", async () => {
    const icons = Array.from({ length: 5 }, () => deferred<string | null>());
    let nextIcon = 0;
    vi.mocked(native.apps).mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        ...application(`app-${index}`, `App ${index}`),
        hasIcon: true,
      })),
    );
    vi.mocked(native.icon).mockImplementation(() => icons[nextIcon++].promise);
    render(<App />);
    await screen.findByText("App 4");
    expect(native.icon).toHaveBeenCalledTimes(4);
    await act(async () => {
      icons[0].resolve(null);
    });
    expect(native.icon).toHaveBeenCalledTimes(5);
    await act(async () => {
      for (const icon of icons.slice(1)) icon.resolve(null);
    });
  });

  it("memoizes successful icons only until the authenticated session changes", async () => {
    vi.mocked(native.apps).mockResolvedValue([
      { ...application("firefox", "Mozilla Firefox"), hasIcon: true },
    ]);
    vi.mocked(native.icon).mockResolvedValue("data:image/png;base64,AA==");
    vi.mocked(native.connect).mockResolvedValue({
      backgroundCheckRegistered: true,
    });
    render(<App />);
    await screen.findByText("Mozilla Firefox");
    await act(async () => {});
    expect(native.icon).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    submitConnection();
    await screen.findByText("Mozilla Firefox");
    await act(async () => {});
    expect(vi.mocked(native.icon).mock.calls.length).toBeGreaterThan(1);
  });
});
