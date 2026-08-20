import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { AppAction } from "./models";
import { native } from "./native";
import {
  appAction,
  authCapabilities,
  availableApp,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
  signOutOutcome,
} from "./testFixtures";

vi.mock("./native", async () => {
  const { createNativeMock: createMock } = await import("./testFixtures");
  return { native: createMock() };
});

beforeEach(() => {
  resetNativeMockDefaults(vi.mocked(native));
});

afterEach(() => {
  vi.useRealTimers();
});

function submitConnection(username = "ada", token = "secret-token") {
  fireEvent.change(screen.getByLabelText("Relution username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText("Personal access token"), {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
}

function findSignOut() {
  return screen.findByRole("button", { name: "Sign out" }, { timeout: 5_000 });
}

async function signOutToConnect() {
  fireEvent.click(await findSignOut());
  await act(async () => {
    await Promise.resolve();
  });
}

function enableWrites() {
  vi.mocked(native.bootstrap).mockResolvedValue(
    nativeBootstrap({ writesEnabled: true }),
  );
}

describe("App", () => {
  it("loads the catalog after sign-in even while the initial view is pending", async () => {
    const initialView = deferred<"apps" | "updates">();
    vi.mocked(native.initialView).mockReturnValue(initialView.promise);
    vi.mocked(native.connect).mockResolvedValue({
      backgroundCheckRegistered: true,
    });
    render(<App />);

    submitConnection();
    expect(native.connect).toHaveBeenCalledTimes(1);
    expect(native.bootstrap).not.toHaveBeenCalled();

    await act(async () => {
      initialView.resolve("apps");
      await initialView.promise;
    });

    expect(native.bootstrap).toHaveBeenCalledTimes(1);
    expect(native.apps).toHaveBeenCalledTimes(1);
    expect(native.apps).toHaveBeenCalledWith("apps");
  });

  it("states that an empty catalog is not an error", async () => {
    render(<App />);
    expect(await screen.findByText("Nothing to show")).toBeTruthy();
    expect(screen.getByText("For this device")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Available (0)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Updates (0)" })).toBeTruthy();
  });

  it("shows available and update counts after bootstrap", async () => {
    vi.mocked(native.bootstrap).mockResolvedValue(
      nativeBootstrap({ availableCount: 4, updates: { count: 2, keys: [] } }),
    );
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Available (4)" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Updates (2)" })).toBeTruthy();
  });

  it("keeps navigation labels plain until bootstrap completes", async () => {
    const bootstrap = deferred<ReturnType<typeof nativeBootstrap>>();
    vi.mocked(native.bootstrap).mockReturnValue(bootstrap.promise);
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Available" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Updates" })).toBeTruthy();

    bootstrap.resolve(nativeBootstrap());
    expect(
      await screen.findByRole("button", { name: "Available (0)" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Updates (0)" })).toBeTruthy();
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
        ...availableApp("firefox", "Mozilla Firefox"),
        description: "Managed browser",
        publisher: "Mozilla",
        packageIdentifier: "Mozilla.Firefox",
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
});

describe("App catalog", () => {
  it("does not expose mutation controls in a read-only build", async () => {
    vi.mocked(native.apps).mockResolvedValue([
      availableApp("firefox", "Mozilla Firefox"),
    ]);
    render(<App />);
    expect(
      await screen.findByText(
        "Read-only candidate. Installation and updates are disabled.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(native.act).not.toHaveBeenCalled();
  });

  it("shows installed to available versions for updates", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.apps).mockResolvedValue([
      {
        ...availableApp("firefox", "Mozilla Firefox"),
        releasedVersionLabel: "128.0.4",
        installedVersionId: "installed",
        installedVersionLabel: "128.0.3",
        installState: "update_available",
      },
    ]);
    render(<App />);
    expect(
      await screen.findByLabelText(
        "Installed version: 128.0.3. Available version: 128.0.4.",
      ),
    ).toBeTruthy();
  });

  it("keeps complete long version labels available to assistive technology", async () => {
    const installed =
      "128.0.3-enterprise-managed-release-with-a-very-long-build-metadata-suffix";
    const available =
      "128.0.4-enterprise-managed-release-with-a-very-long-build-metadata-suffix";
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.apps).mockResolvedValue([
      availableApp("firefox", "Mozilla Firefox", {
        releasedVersionLabel: available,
        installedVersionId: "installed",
        installedVersionLabel: installed,
        installState: "update_available",
      }),
    ]);
    render(<App />);

    const rail = await screen.findByLabelText(
      `Installed version: ${installed}. Available version: ${available}.`,
    );
    expect(rail.textContent).toContain(installed);
    expect(rail.textContent).toContain(available);
  });
});

describe("App confirmation", () => {
  it("requires a focused cancellation before an install", async () => {
    enableWrites();
    vi.mocked(native.apps).mockResolvedValue([
      availableApp("firefox", "Mozilla Firefox"),
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
});

describe("App session", () => {
  it("retains authenticated state when credential deletion fails", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ credentialRemoved: false }),
    );
    render(<App />);
    fireEvent.click(await findSignOut());
    expect(
      await screen.findByText(
        "Sign-out is incomplete because this device could not delete its stored credential. Contact IT before using this shared device.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("App session cleanup", () => {
  it("reports background-task cleanup failure after local sign-out", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ scheduledTaskRemoved: false }),
    );
    render(<App />);
    fireEvent.click(await findSignOut());
    expect(
      await screen.findByText(
        "Signed out locally. Revoke the token in your Relution profile if it is no longer needed; some background cleanup did not complete.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("reports notification-state cleanup failure after local sign-out", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ notificationStateCleared: false }),
    );
    render(<App />);
    fireEvent.click(await findSignOut());
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
    fireEvent.click(await findSignOut());
    submitConnection();
    expect(
      await screen.findByText(
        "Background update checks could not be registered. Keep Appport open to receive update status.",
      ),
    ).toBeTruthy();
  });
});

describe("App connection", () => {
  it("clears credentials from the form before connection completes", async () => {
    const pending = deferred<{ backgroundCheckRegistered: boolean }>();
    vi.mocked(native.connect).mockReturnValue(pending.promise);
    render(<App />);
    await signOutToConnect();
    submitConnection("ada@example.test", "one-use-secret");

    expect(native.connect).toHaveBeenCalledWith({
      authMethod: "personal_token",
      relutionUsername: "ada@example.test",
      accessToken: "one-use-secret",
    });
    expect(
      screen.getByLabelText<HTMLInputElement>("Relution username").value,
    ).toBe("");
    expect(
      screen.getByLabelText<HTMLInputElement>("Personal access token").value,
    ).toBe("");

    act(() => {
      pending.resolve({ backgroundCheckRegistered: true });
    });
  });

  it("keeps the token form simple when password sign-in is unavailable", async () => {
    vi.mocked(native.authCapabilities).mockResolvedValue(authCapabilities());
    render(<App />);

    await screen.findByLabelText("Personal access token");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("offers password sign-in only when supported and clears secrets on switch", async () => {
    vi.mocked(native.authCapabilities).mockResolvedValue(
      authCapabilities({ password: true }),
    );
    render(<App />);

    await findSignOut();
    fireEvent.click(screen.getByText("Renew or replace token"));
    const passwordMethod = await screen.findByRole("radio", {
      name: "Password",
    });
    const username =
      screen.getByLabelText<HTMLInputElement>("Relution username");
    const token = screen.getByLabelText<HTMLInputElement>(
      "Personal access token",
    );
    expect(
      screen.getByRole<HTMLInputElement>("radio", {
        name: "Personal token",
      }).checked,
    ).toBe(true);
    expect(token.autocomplete).toBe("off");

    fireEvent.change(username, { target: { value: "ada@example.test" } });
    fireEvent.change(token, { target: { value: "personal-token" } });
    fireEvent.click(passwordMethod);
    await act(async () => {
      await Promise.resolve();
    });

    const password = screen.getByLabelText<HTMLInputElement>("Password", {
      selector: 'input[type="password"]',
    });
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: "Password" }).checked,
    ).toBe(true);
    expect(username.value).toBe("");
    expect(password.value).toBe("");
    expect(password.autocomplete).toBe("current-password");
  });

  it("prevents a duplicate pending sign-in attempt", async () => {
    const pending = deferred<{ backgroundCheckRegistered: boolean }>();
    vi.mocked(native.connect).mockReturnValue(pending.promise);
    render(<App />);
    await signOutToConnect();

    submitConnection();
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect.hasAttribute("disabled")).toBe(true);
    fireEvent.click(connect);
    expect(native.connect).toHaveBeenCalledTimes(1);

    act(() => {
      pending.resolve({ backgroundCheckRegistered: true });
    });
  });

  it("maps unsupported sign-in methods without exposing native details", async () => {
    vi.mocked(native.connect).mockRejectedValue({
      code: "AUTH_METHOD_UNSUPPORTED",
      message: "native details must not reach the UI",
    });
    render(<App />);
    await signOutToConnect();
    submitConnection();

    expect(
      await screen.findByText("This sign-in method is unavailable"),
    ).toBeTruthy();
    expect(
      screen.queryByText("native details must not reach the UI"),
    ).toBeNull();
  });
});

describe("App catalog refresh", () => {
  it("does not let an older Available catalog replace Updates", async () => {
    const available = deferred<ReturnType<typeof availableApp>[]>();
    const updates = deferred<ReturnType<typeof availableApp>[]>();
    vi.mocked(native.apps).mockImplementation((view) =>
      view === "apps" ? available.promise : updates.promise,
    );
    render(<App />);
    await screen.findByRole("button", { name: "Available" });
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    updates.resolve([availableApp("update", "Update result")]);
    await act(() => updates.promise);
    expect(await screen.findByText("Update result")).toBeTruthy();
    available.resolve([availableApp("available", "Available result")]);
    await act(() => available.promise);
    expect(screen.queryByText("Available result")).toBeNull();
    expect(screen.getByText("Update result")).toBeTruthy();
  });
});

it(
  "pauses polling after a transient failure without inventing an unknown result",
  pausesPollingAfterFailure,
);
async function pausesPollingAfterFailure() {
  vi.useFakeTimers();
  enableWrites();
  vi.mocked(native.apps).mockResolvedValue([
    availableApp("firefox", "Mozilla Firefox"),
  ]);
  vi.mocked(native.act).mockResolvedValue(appAction("queued"));
  vi.mocked(native.action).mockRejectedValue(
    new Error("temporary IPC failure"),
  );
  render(<App />);
  await act(async () => {
    await Promise.resolve();
  });
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
}

it("polls iteratively to a terminal Relution state", pollsToTerminalState);
async function pollsToTerminalState() {
  vi.useFakeTimers();
  enableWrites();
  vi.mocked(native.apps).mockResolvedValue([
    availableApp("firefox", "Mozilla Firefox"),
  ]);
  vi.mocked(native.act).mockResolvedValue(appAction("queued"));
  vi.mocked(native.action)
    .mockResolvedValueOnce(appAction("verifying"))
    .mockResolvedValueOnce(appAction("succeeded"));
  render(<App />);
  await act(() => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000);
  });

  expect(screen.getByText("Status: succeeded")).toBeTruthy();
  expect(native.action).toHaveBeenCalledTimes(2);
  expect(native.apps).toHaveBeenCalledTimes(2);
}

it(
  "resumes a paused action and preserves its action identifier",
  resumesPausedAction,
);
async function resumesPausedAction() {
  vi.useFakeTimers();
  enableWrites();
  vi.mocked(native.apps).mockResolvedValue([
    availableApp("firefox", "Mozilla Firefox"),
  ]);
  vi.mocked(native.act).mockResolvedValue(appAction("queued"));
  vi.mocked(native.action)
    .mockRejectedValueOnce(new Error("temporary IPC failure"))
    .mockResolvedValueOnce(appAction("succeeded"));
  render(<App />);
  await act(() => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(screen.getByText("action-42")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Resume status checks" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(screen.getByText("Status: succeeded")).toBeTruthy();
}

it(
  "shows unknown only when the Relution workflow returns unknown",
  showsUnknownAction,
);
async function showsUnknownAction() {
  vi.useFakeTimers();
  enableWrites();
  vi.mocked(native.apps).mockResolvedValue([
    availableApp("firefox", "Mozilla Firefox"),
  ]);
  vi.mocked(native.act).mockResolvedValue(appAction("queued"));
  vi.mocked(native.action).mockResolvedValue(appAction("unknown"));
  render(<App />);
  await act(() => Promise.resolve());
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
}

it("ignores an in-flight polling result after sign-out", () =>
  ignoresPollAfterSignOut());
const ignoresPollAfterSignOut = async () => {
  vi.useFakeTimers();
  enableWrites();
  const refresh = deferred<AppAction>();
  vi.mocked(native.apps).mockResolvedValue([
    availableApp("firefox", "Mozilla Firefox"),
  ]);
  vi.mocked(native.act).mockResolvedValue(appAction("queued"));
  vi.mocked(native.action).mockReturnValue(refresh.promise);
  render(<App />);
  await act(() => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  refresh.resolve(appAction("succeeded"));
  await act(() => refresh.promise);
  expect(screen.queryByText("Status: succeeded")).toBeNull();
  expect(screen.getByLabelText("Relution username")).toBeTruthy();
};

it("keeps action-start failures local to the application card", () =>
  keepsActionFailureLocal());
const keepsActionFailureLocal = async () => {
  enableWrites();
  vi.mocked(native.apps).mockResolvedValue([
    availableApp("firefox", "Mozilla Firefox"),
    availableApp("sevenzip", "7-Zip"),
  ]);
  vi.mocked(native.act).mockRejectedValue({ code: "ACTION" });
  render(<App />);
  await screen.findByText("7-Zip");
  fireEvent.click(screen.getAllByRole("button", { name: "Install" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Action could not be started")).toBeTruthy();
  expect(screen.getByText("7-Zip")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(2);
};

it("clears a pending poll timer when the client unmounts", () =>
  clearsPendingTimer());
const clearsPendingTimer = async () => {
  vi.useFakeTimers();
  enableWrites();
  vi.mocked(native.apps).mockResolvedValue([
    availableApp("firefox", "Mozilla Firefox"),
  ]);
  vi.mocked(native.act).mockResolvedValue(
    appAction("queued", { id: "action-43" }),
  );
  const { unmount } = render(<App />);
  await act(() => Promise.resolve());
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await act(() => Promise.resolve());
  const timerCountWithPoll = vi.getTimerCount();
  expect(timerCountWithPoll).toBeGreaterThan(0);
  unmount();
  expect(vi.getTimerCount()).toBe(timerCountWithPoll - 1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(native.action).not.toHaveBeenCalled();
};

it("limits icon loading to four concurrent requests", limitsIconLoading);
async function limitsIconLoading() {
  const icons = Array.from({ length: 5 }, () => deferred<string | null>());
  let nextIcon = 0;
  vi.mocked(native.apps).mockResolvedValue(
    Array.from({ length: 5 }, (_, index) => ({
      ...availableApp(`app-${index}`, `App ${index}`),
      hasIcon: true,
    })),
  );
  vi.mocked(native.icon).mockImplementation(() => icons[nextIcon++].promise);
  render(<App />);
  await screen.findByText("App 4");
  expect(native.icon).toHaveBeenCalledTimes(4);
  icons[0].resolve(null);
  await act(() => icons[0].promise);
  expect(native.icon).toHaveBeenCalledTimes(5);
  for (const icon of icons.slice(1)) icon.resolve(null);
  await act(async () => {
    await Promise.all(icons.slice(1).map(({ promise }) => promise));
  });
}

it(
  "memoizes successful icons only until the authenticated session changes",
  memoizesIconsPerSession,
);
async function memoizesIconsPerSession() {
  vi.mocked(native.apps).mockResolvedValue([
    { ...availableApp("firefox", "Mozilla Firefox"), hasIcon: true },
  ]);
  vi.mocked(native.icon).mockResolvedValue("data:image/png;base64,AA==");
  vi.mocked(native.connect).mockResolvedValue({
    backgroundCheckRegistered: true,
  });
  render(<App />);
  await screen.findByText("Mozilla Firefox");
  await act(() => Promise.resolve());
  expect(native.icon).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  submitConnection();
  await screen.findByText("Mozilla Firefox");
  await act(() => Promise.resolve());
  expect(vi.mocked(native.icon).mock.calls.length).toBeGreaterThan(1);
}
