import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  availableApp,
  catalogSnapshot,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
} from "../testing/nativeMock";
import { native } from "../native-bridge/native";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../testing/nativeMock");
  return { native: createNativeMock() };
});

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("App journeys", () => {
  it("starts at the native-selected updates view and exposes complete version context", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.loadCatalog).mockResolvedValue(
      catalogSnapshot(
        [
          availableApp("edge", "Microsoft Edge", {
            installState: "update_available",
            installedVersionId: "old",
            installedVersionLabel: "127",
            releasedVersionLabel: "128",
          }),
        ],
        nativeBootstrap({
          updates: { count: 1, keys: ["edge"] },
          writesEnabled: true,
        }),
      ),
    );
    render(<App />);
    expect(
      (await screen.findByRole("button", { name: "Updates (1)" })).className,
    ).toContain("active");
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(
      screen.getByLabelText("Installed version: 127. Available version: 128."),
    ).toBeTruthy();
    const available = screen.getByRole("button", { name: "Available (0)" });
    expect(available.className).not.toContain("active");
    fireEvent.click(available);
    expect(
      screen.getByRole("button", { name: "Available (0)" }).className,
    ).toContain("active");
  });

  it("keeps the signed-out surface focused on the token-only connection form", async () => {
    const bootstrap = deferred<ReturnType<typeof catalogSnapshot>>();
    vi.mocked(native.loadCatalog).mockReturnValue(bootstrap.promise);
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Sign in to Appport" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
    expect(screen.getByLabelText("Personal access token")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Software views" }),
    ).toBeNull();
    bootstrap.resolve(catalogSnapshot());
  });

  it("clears entered credentials synchronously after submitting a connection", async () => {
    const pending = deferred<{ backgroundCheckRegistered: boolean }>();
    const bootstrap = deferred<ReturnType<typeof catalogSnapshot>>();
    vi.mocked(native.loadCatalog).mockReturnValue(bootstrap.promise);
    vi.mocked(native.connect).mockReturnValue(pending.promise);
    render(<App />);
    const username = await screen.findByLabelText("Relution username");
    const token = screen.getByLabelText("Personal access token");
    fireEvent.change(username, { target: { value: "ada" } });
    fireEvent.change(token, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(native.connect).toHaveBeenCalledWith({
      authMethod: "personal_token",
      relutionUsername: "ada",
      accessToken: "secret",
    });
    expect((username as HTMLInputElement).value).toBe("");
    expect((token as HTMLInputElement).value).toBe("");
    await act(async () => {
      pending.resolve({ backgroundCheckRegistered: true });
      await pending.promise;
    });
    bootstrap.resolve(catalogSnapshot());
  });

  it("keeps the fixed native portal action and keyboard-safe action confirmation", async () => {
    vi.mocked(native.loadCatalog).mockResolvedValue(
      catalogSnapshot(
        [availableApp("firefox", "Firefox")],
        nativeBootstrap({
          updates: { count: 1, keys: ["edge"] },
          writesEnabled: true,
        }),
      ),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Manage token in Relution" }),
    );
    expect(native.openRelutionPortal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Review installation" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Review installation" }),
    );
    expect(native.act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("heading", { name: "Review installation" }),
    ).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "View" }),
      ),
    );
  });
});

it("refreshes counts and rows together, retaining filters through loading and retry", async () => {
  const first = catalogSnapshot(
    [availableApp("firefox", "Firefox")],
    nativeBootstrap({ availableCount: 1 }),
  );
  vi.mocked(native.loadCatalog).mockResolvedValue(first);
  render(<App />);
  const refresh = await screen.findByRole("button", { name: "Refresh" });
  const query = screen.getByLabelText("Search approved software");
  fireEvent.change(query, { target: { value: "Firefox" } });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "winget" },
  });
  const pending = deferred<ReturnType<typeof catalogSnapshot>>();
  vi.mocked(native.loadCatalog).mockReturnValueOnce(pending.promise);
  fireEvent.click(refresh);
  expect(native.loadCatalog).toHaveBeenLastCalledWith({
    view: "apps",
    forceRefresh: true,
  });
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("heading", { name: "Firefox" })).toBeNull();
  await act(async () => {
    pending.resolve(
      catalogSnapshot(
        [
          availableApp("firefox-new", "Firefox new"),
          availableApp("edge", "Edge"),
        ],
        nativeBootstrap({ availableCount: 2 }),
        "revision-2",
      ),
    );
    await pending.promise;
  });
  expect(screen.getByRole("button", { name: "Available (2)" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Firefox new" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Edge" })).toBeNull();
  expect((query as HTMLInputElement).value).toBe("Firefox");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "winget",
  );
  vi.mocked(native.loadCatalog).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(refresh);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(native.loadCatalog).toHaveBeenCalledTimes(4));
  expect(native.loadCatalog).toHaveBeenLastCalledWith({
    view: "apps",
    forceRefresh: true,
  });
  await screen.findByRole("heading", { name: "Firefox" });
  fireEvent.click(screen.getByRole("button", { name: "Updates (0)" }));
  await waitFor(() =>
    expect(native.loadCatalog).toHaveBeenLastCalledWith({
      view: "updates",
      forceRefresh: false,
    }),
  );
});
