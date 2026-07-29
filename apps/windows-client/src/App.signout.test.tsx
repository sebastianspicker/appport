import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("App sign out", () => {
  it("directs the user to revoke a locally removed token in Relution", async () => {
    vi.mocked(native.signOut).mockResolvedValue({
      tokenRevocationRequired: true,
      credentialRemoved: true,
      scheduledTaskRemoved: true,
      notificationStateCleared: true,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Signed out locally/)).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("does not claim local sign-out when native cleanup could not run", async () => {
    vi.mocked(native.signOut).mockRejectedValue(new Error("IPC unavailable"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Sign-out could not run/)).toBeTruthy();
  });
});
