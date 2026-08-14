import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { native } from "./native";
import { resetNativeMockDefaults, signOutOutcome } from "./testFixtures";

vi.mock("./native", async () => {
  const { createNativeMock: createMock } = await import("./testFixtures");
  return { native: createMock() };
});

beforeEach(() => {
  resetNativeMockDefaults(vi.mocked(native));
});

describe("App sign out", () => {
  it("directs the user to revoke a locally removed token in Relution", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ tokenRevocationRequired: true }),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Sign out" },
        { timeout: 5_000 },
      ),
    );
    expect(await screen.findByText(/Signed out locally/)).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("does not claim local sign-out when native cleanup could not run", async () => {
    vi.mocked(native.signOut).mockRejectedValue(new Error("IPC unavailable"));
    render(<App />);
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Sign out" },
        { timeout: 5_000 },
      ),
    );
    expect(await screen.findByText(/Sign-out could not run/)).toBeTruthy();
  });

  it("preserves revocation guidance after a credential-deletion retry", async () => {
    vi.mocked(native.signOut)
      .mockResolvedValueOnce(signOutOutcome({ credentialRemoved: false }))
      .mockResolvedValueOnce(signOutOutcome({ tokenRevocationRequired: true }));
    render(<App />);
    const signOut = await screen.findByRole(
      "button",
      { name: "Sign out" },
      { timeout: 5_000 },
    );
    fireEvent.click(signOut);
    expect(await screen.findByText(/Sign-out is incomplete/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Signed out locally/)).toBeTruthy();
    expect(
      screen.getByText(/Revoke the token in your Relution profile/),
    ).toBeTruthy();
  });
});
