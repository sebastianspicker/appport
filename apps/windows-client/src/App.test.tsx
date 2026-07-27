import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { native } from "./native";

vi.mock("./native", () => ({
  native: {
    initialView: vi.fn().mockResolvedValue("apps"),
    beginConnect: vi.fn(),
    bootstrap: vi.fn().mockResolvedValue({
      user: { displayName: "Ada" },
      device: { name: "PC", status: "COMPLIANT", lastSeenAt: null },
      sessionExpiresAt: "2026-08-01T00:00:00.000Z",
      updateCount: 0,
    }),
    apps: vi.fn().mockResolvedValue([]),
    installed: vi.fn().mockResolvedValue([]),
    act: vi.fn(),
    action: vi.fn(),
    icon: vi.fn().mockResolvedValue(null),
    signOut: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.initialView).mockResolvedValue("apps");
  vi.mocked(native.apps).mockResolvedValue([]);
  vi.mocked(native.signOut).mockResolvedValue({
    remoteRevocation: "revoked",
    credentialDeletion: "deleted",
    scheduledTaskRemoval: "removed",
  });
});

describe("App", () => {
  it("states that an empty catalog is not an error", async () => {
    render(<App />);
    expect(await screen.findByText("Nothing to show")).toBeTruthy();
    expect(screen.getByText("For this device")).toBeTruthy();
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
        installState: "not_installed",
        activeActionId: null,
        activeActionState: null,
        iconUrl: null,
      },
    ]);
    render(<App />);
    expect(await screen.findByText("Mozilla Firefox")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search approved software"), {
      target: { value: "does not exist" },
    });
    expect(
      screen.getByText("No approved software matches your search."),
    ).toBeTruthy();
    expect(screen.queryByText("Loading this device")).toBeNull();
  });

  it("requires a focused cancellation before an install", async () => {
    vi.mocked(native.apps).mockResolvedValue([
      { id: "firefox", name: "Mozilla Firefox", description: null, publisher: null, source: "winget", packageIdentifier: null, releasedVersionId: "release", releasedVersionLabel: "128", installedVersionId: null, installedVersionLabel: null, installState: "not_installed", activeActionId: null, activeActionState: null, iconUrl: null },
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
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(native.act).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(install);
  });

  it("reports remote sign-out failure after clearing local state", async () => {
    vi.mocked(native.signOut).mockResolvedValue({
      remoteRevocation: "failed",
      credentialDeletion: "deleted",
      scheduledTaskRemoval: "removed",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText(
        "Signed out locally, but remote revocation or background cleanup did not complete. Contact IT if this device may be at risk.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Sign in" }).length).toBeGreaterThan(0);
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
      remoteRevocation: "revoked",
      credentialDeletion: "failed",
      scheduledTaskRemoval: "removed",
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
      remoteRevocation: "revoked",
      credentialDeletion: "deleted",
      scheduledTaskRemoval: "failed",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText(
        "Signed out locally, but remote revocation or background cleanup did not complete. Contact IT if this device may be at risk.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Sign in" }).length).toBeGreaterThan(0);
  });
});
