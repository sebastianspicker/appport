import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  availableApp,
  createNativeMock,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
} from "../test/nativeMock";
import { native } from "../native-bridge/native";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../test/nativeMock");
  return { native: createNativeMock() };
});

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("App journeys", () => {
  it("starts at the native-selected updates view and exposes complete version context", async () => {
    vi.mocked(native.initialView).mockResolvedValue("updates");
    vi.mocked(native.bootstrap).mockResolvedValue(
      nativeBootstrap({ updates: { count: 1, keys: ["edge"] } }),
    );
    vi.mocked(native.apps).mockResolvedValue([
      availableApp("edge", "Microsoft Edge", {
        installState: "update_available",
        installedVersionId: "old",
        installedVersionLabel: "127",
        releasedVersionLabel: "128",
      }),
    ]);
    render(<App />);
    expect(
      (await screen.findByRole("button", { name: "Updates (1)" })).className,
    ).toContain("active");
    expect(
      screen.getByLabelText("Installed version: 127. Available version: 128."),
    ).toBeTruthy();
  });

  it("clears entered credentials synchronously after submitting a connection", async () => {
    const pending = deferred<{ backgroundCheckRegistered: boolean }>();
    const bootstrap = deferred<ReturnType<typeof nativeBootstrap>>();
    vi.mocked(native.bootstrap).mockReturnValue(bootstrap.promise);
    vi.mocked(native.connect).mockReturnValue(pending.promise);
    render(<App />);
    const username = await screen.findByLabelText("Relution username");
    const token = screen.getByLabelText("Personal access token");
    fireEvent.change(username, { target: { value: "ada" } });
    fireEvent.change(token, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
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
    bootstrap.resolve(nativeBootstrap());
  });

  it("keeps the fixed native portal action and keyboard-safe action confirmation", async () => {
    vi.mocked(native.bootstrap).mockResolvedValue(
      nativeBootstrap({ writesEnabled: true }),
    );
    vi.mocked(native.apps).mockResolvedValue([
      availableApp("firefox", "Firefox"),
    ]);
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Manage token in Relution" }),
    );
    expect(native.openRelutionPortal).toHaveBeenCalledTimes(1);
    const install = await screen.findByRole("button", { name: "Install" });
    install.focus();
    fireEvent.click(install);
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(install);
  });
});
