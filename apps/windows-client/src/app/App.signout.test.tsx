import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import { resetNativeMockDefaults, signOutOutcome } from "../test/nativeMock";
import { App } from "./App";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../test/nativeMock");
  return { native: createNativeMock() };
});

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("App sign out", () => {
  it("directs users to revoke a locally removed token", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ tokenRevocationRequired: true }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Signed out locally/)).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("does not claim sign-out when native cleanup fails", async () => {
    vi.mocked(native.signOut).mockRejectedValue(new Error("IPC unavailable"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Sign-out could not run/)).toBeTruthy();
  });

  it("keeps revocation guidance after a credential-deletion retry", async () => {
    vi.mocked(native.signOut)
      .mockResolvedValueOnce(signOutOutcome({ credentialRemoved: false }))
      .mockResolvedValueOnce(signOutOutcome({ tokenRevocationRequired: true }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Sign-out is incomplete/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Signed out locally/)).toBeTruthy();
  });
});
