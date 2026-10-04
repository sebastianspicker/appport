import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { native } from "../native-bridge/native";
import {
  availableApp,
  catalogSnapshot,
  nativeBootstrap,
  resetNativeMockDefaults,
} from "../testing/nativeMock";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../testing/nativeMock");
  return { native: createNativeMock() };
});
beforeEach(() => {
  resetNativeMockDefaults(vi.mocked(native));
  vi.mocked(native.loadCatalog).mockResolvedValue(
    catalogSnapshot(
      [availableApp("editor", "Editor")],
      nativeBootstrap({ writesEnabled: true }),
    ),
  );
});

async function openReview() {
  const view = await screen.findByRole("button", { name: "View" });
  expect(view.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(view);
  expect(view.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Review installation" }));
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Review installation" }),
  );
}

it("requires disclosure and review before sending a request, and restores usable focus on cancel", async () => {
  render(<App />);
  await openReview();
  expect(native.act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "View" }),
    ),
  );
  expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
});

it("invalidates an unsent review on task navigation", async () => {
  render(<App />);
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: /Updates \(/ }));
  expect(
    screen.queryByRole("button", { name: "Request installation" }),
  ).toBeNull();
  expect(native.act).not.toHaveBeenCalled();
});

it("shows a dismissible receipt only after confirmed success removes the application from refreshed inventory", async () => {
  vi.mocked(native.act).mockResolvedValue({
    id: "action",
    appId: "editor",
    deviceId: "device",
    intent: "install",
    state: "succeeded",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
  });
  render(<App />);
  await openReview();
  vi.mocked(native.loadCatalog).mockResolvedValue(
    catalogSnapshot(
      [],
      nativeBootstrap({ writesEnabled: true, availableCount: 0 }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Request installation" }));
  expect(
    await screen.findByText("Editor · Installation confirmed"),
  ).toBeTruthy();
  expect(native.act).toHaveBeenCalledTimes(1);
  expect(document.activeElement?.textContent).toContain(
    "Editor · Installation confirmed",
  );
  expect(screen.queryByRole("heading", { name: "Editor" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByText("Editor · Installation confirmed")).toBeNull();
});

it("never offers a new request for an unknown submission", async () => {
  vi.mocked(native.act).mockResolvedValue({
    id: "action",
    appId: "editor",
    deviceId: "device",
    intent: "install",
    state: "unknown",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
  });
  render(<App />);
  await openReview();
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Request installation" }),
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Request installation" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(native.act).toHaveBeenCalledTimes(1);
});

it("invalidates the review when the session signs out", async () => {
  render(<App />);
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByLabelText("Relution username");
  expect(
    screen.queryByRole("button", { name: "Request installation" }),
  ).toBeNull();
  expect(native.act).not.toHaveBeenCalled();
});

it("keeps a rejected request in the task with an error and a return path", async () => {
  vi.mocked(native.act).mockRejectedValue({ code: "SERVER" });
  render(<App />);
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "Request installation" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: "Request installation" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Back to overview/ }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "View" }),
    ),
  );
  expect(native.act).toHaveBeenCalledTimes(1);
});

it("shows verification as the task phase without a misleading Starting control", async () => {
  vi.mocked(native.act).mockResolvedValue({
    id: "action",
    appId: "editor",
    deviceId: "device",
    intent: "install",
    state: "verifying",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
  });
  render(<App />);
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "Request installation" }));
  await screen.findByRole("heading", { name: "Verifying installation" });
  expect(screen.queryByRole("button", { name: "Starting…" })).toBeNull();
  expect(screen.getByText("Reviewed version")).toBeTruthy();
  expect(native.act).toHaveBeenCalledTimes(1);
});

it("retains unknown-submission guidance when changing catalog tabs", async () => {
  vi.mocked(native.act).mockResolvedValue({
    id: "unknown-action",
    appId: "editor",
    deviceId: "device",
    intent: "install",
    state: "unknown",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
  });
  render(<App />);
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "Request installation" }));
  await screen.findByText("unknown-action");
  fireEvent.click(screen.getByRole("button", { name: /Updates \(/ }));
  expect(screen.getByText("unknown-action")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Request installation" }),
  ).toBeNull();
  expect(native.act).toHaveBeenCalledTimes(1);
});

it("does not produce a receipt from absence in another catalog view", async () => {
  vi.mocked(native.act).mockResolvedValue({
    id: "succeeded-action",
    appId: "editor",
    deviceId: "device",
    intent: "install",
    state: "succeeded",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
  });
  render(<App />);
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "Request installation" }));
  await waitFor(() => expect(native.loadCatalog).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Editor · Installation confirmed")).toBeNull();
  vi.mocked(native.loadCatalog).mockResolvedValue(
    catalogSnapshot([], nativeBootstrap({ writesEnabled: true })),
  );
  fireEvent.click(screen.getByRole("button", { name: /Updates \(/ }));
  await waitFor(() => expect(native.loadCatalog).toHaveBeenCalledTimes(3));
  expect(
    screen.getByRole("heading", { name: "Installation status" }),
  ).toBeTruthy();
  expect(screen.queryByText("Editor · Installation confirmed")).toBeNull();
});
