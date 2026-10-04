import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import {
  deferred,
  resetNativeMockDefaults,
  signOutOutcome,
} from "../testing/nativeMock";
import { App } from "./App";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../testing/nativeMock");
  return { native: createNativeMock() };
});

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("App sign out", () => {
  it("directs users to revoke a locally removed token", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ tokenRevocationRequired: true }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Signed out locally/)).toBeTruthy();
    expect(screen.getByLabelText("Relution username")).toBeTruthy();
  });

  it("does not claim sign-out when native cleanup fails", async () => {
    const retry = deferred<ReturnType<typeof signOutOutcome>>();
    vi.mocked(native.signOut)
      .mockRejectedValueOnce(new Error("IPC unavailable"))
      .mockReturnValueOnce(retry.promise);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      (await screen.findAllByText(/Sign-out could not run/))[0],
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.queryByText(/Sign-out could not run/)).toBeNull();
    expect(
      screen.getByText("Finishing any submitted work before signing out."),
    ).toBeTruthy();
    await act(async () => {
      retry.resolve(signOutOutcome());
    });
  });

  it("keeps revocation guidance after a credential-deletion retry", async () => {
    vi.mocked(native.signOut)
      .mockResolvedValueOnce(signOutOutcome({ credentialRemoved: false }))
      .mockResolvedValueOnce(signOutOutcome({ tokenRevocationRequired: true }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      (await screen.findAllByText(/Sign-out is incomplete/))[0],
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/Signed out locally/)).toBeTruthy();
  });
});
