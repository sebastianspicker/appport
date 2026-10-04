import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { native } from "../native-bridge/native";
import {
  availableApp,
  catalogSnapshot,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
  signOutOutcome,
} from "../testing/nativeMock";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../testing/nativeMock");
  return { native: createNativeMock() };
});
beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("session feedback", () => {
  it("announces a pending sign-in, prevents resubmission, and shows rejection without retaining the token", async () => {
    vi.mocked(native.loadCatalog).mockRejectedValue(
      new Error("session_expired"),
    );
    const connection = deferred<{ backgroundCheckRegistered: boolean }>();
    vi.mocked(native.connect).mockReturnValue(connection.promise);
    render(<App />);
    const username = await screen.findByLabelText("Relution username");
    const token = screen.getByLabelText("Personal access token");
    fireEvent.change(username, { target: { value: "ada" } });
    fireEvent.change(token, { target: { value: "synthetic-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("status").textContent).toBe("Signing in…");
    const pending = screen.getByRole("button", { name: "Signing in…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    expect(native.connect).toHaveBeenCalledTimes(1);
    expect((token as HTMLInputElement).value).toBe("");
    await act(async () => {
      connection.reject({ code: "OFFLINE", message: "offline" });
    });
    expect(screen.getByRole("alert").textContent).toContain("You are offline");
    expect(
      (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("handles a failed portal launch and allows retry", async () => {
    const opening = deferred<void>();
    vi.mocked(native.openRelutionPortal).mockReturnValueOnce(opening.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Manage token in Relution" }),
    );
    const pending = screen.getByRole("button", { name: "Opening Relution…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    await act(async () => {
      opening.reject(new Error("launch failed"));
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Relution could not be opened",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Manage token in Relution" }),
    );
    await waitFor(() =>
      expect(native.openRelutionPortal).toHaveBeenCalledTimes(2),
    );
  });

  it("admits only one sign-out while native work finishes and focuses the signed-out form", async () => {
    const pending = deferred<ReturnType<typeof signOutOutcome>>();
    vi.mocked(native.signOut).mockReturnValue(pending.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      screen
        .getByText("Finishing any submitted work before signing out.")
        .getAttribute("role"),
    ).toBe("status");
    const busy = screen.getByRole("button", { name: "Signing out…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(native.signOut).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(signOutOutcome());
    });
    expect(document.activeElement).toBe(
      screen.getByLabelText("Relution username"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("catalog navigation", () => {
  it("opens support on demand, focuses its heading, and preserves filters when returning", async () => {
    vi.mocked(native.loadCatalog).mockResolvedValue(
      catalogSnapshot([availableApp("editor", "Editor")]),
    );
    render(<App />);
    const search = await screen.findByLabelText("Search approved software");
    fireEvent.change(search, { target: { value: "Editor" } });
    expect(native.supportDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Support" }));
    await screen.findByText("Windows 11");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("main")),
    );
    expect(
      screen.getByRole("heading", { name: "Support", level: 1 }),
    ).toBeTruthy();
    expect(native.supportDetails).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Available \(/ }));
    expect(
      (screen.getByLabelText("Search approved software") as HTMLInputElement)
        .value,
    ).toBe("Editor");
    fireEvent.click(screen.getByRole("button", { name: "Support" }));
    expect(native.supportDetails).toHaveBeenCalledTimes(1);
  });

  it("clears both filters from a no-results state without fetching again", async () => {
    vi.mocked(native.loadCatalog).mockResolvedValue(
      catalogSnapshot([availableApp("editor", "Editor")]),
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Search approved software"), {
      target: { value: "missing" },
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "windows_msi" },
    });
    expect(
      screen.getByText("No approved software matches your search."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0],
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "all",
    );
    expect(screen.getByRole("heading", { name: "Editor" })).toBeTruthy();
    expect(native.loadCatalog).toHaveBeenCalledTimes(1);
  });
});

it("focuses request status while its confirmed request is pending", async () => {
  vi.mocked(native.loadCatalog).mockResolvedValue(
    catalogSnapshot(
      [availableApp("firefox", "Firefox")],
      nativeBootstrap({ writesEnabled: true }),
    ),
  );
  const action = deferred<Awaited<ReturnType<typeof native.act>>>();
  vi.mocked(native.act).mockReturnValue(action.promise);
  render(<App />);
  const install = await screen.findByRole("button", { name: "View" });
  expect(screen.getByText("1 application")).toBeTruthy();
  install.focus();
  fireEvent.click(install);
  fireEvent.click(screen.getByRole("button", { name: "Review installation" }));
  fireEvent.click(screen.getByRole("button", { name: "Request installation" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Installation status" }),
  );
  expect(
    (screen.getByRole("button", { name: "Starting…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () => {
    action.reject({ code: "SERVER" });
  });
});
