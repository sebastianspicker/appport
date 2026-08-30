import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupportPanel } from "./SupportPanel";
import {
  createNativeMock,
  deferred,
  nativeBootstrap,
  resetNativeMockDefaults,
  supportDetails,
} from "../test/nativeMock";
import { native } from "../native-bridge/native";

const writeText = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));
vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../test/nativeMock");
  return { native: createNativeMock() };
});

beforeEach(() => {
  resetNativeMockDefaults(vi.mocked(native));
  writeText.mockReset().mockResolvedValue(undefined);
});

function openSupport() {
  fireEvent.click(screen.getByLabelText("Support").querySelector("summary")!);
}

describe("SupportPanel", () => {
  it("refreshes details before requiring explicit consent for a bundle", async () => {
    render(<SupportPanel bootstrap={nativeBootstrap()} locale="en" />);
    openSupport();
    await screen.findByText("Windows 11");
    fireEvent.click(
      screen.getByRole("button", { name: "Generate support bundle" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(native.supportDetails).toHaveBeenCalledTimes(2);
    expect(native.generateSupportBundle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(native.generateSupportBundle).toHaveBeenCalledWith(true),
    );
  });

  it("suppresses stale detail responses after the device identity changes", async () => {
    const oldDetails = deferred<ReturnType<typeof supportDetails>>();
    vi.mocked(native.supportDetails).mockReturnValue(oldDetails.promise);
    const rendered = render(
      <SupportPanel bootstrap={nativeBootstrap()} locale="en" />,
    );
    openSupport();
    rendered.rerender(
      <SupportPanel
        bootstrap={nativeBootstrap({
          device: { name: "New PC", status: "COMPLIANT", lastSeenAt: null },
        })}
        locale="en"
      />,
    );
    oldDetails.resolve(supportDetails({ deviceName: "Old PC" }));
    await act(async () => {
      await oldDetails.promise;
    });
    expect(screen.queryByText("Old PC")).toBeNull();
  });

  it("reports clipboard and folder failures without unhandled UI state", async () => {
    vi.mocked(native.openSupportFolder).mockRejectedValue(new Error("blocked"));
    writeText.mockRejectedValue(new Error("blocked"));
    render(<SupportPanel bootstrap={nativeBootstrap()} locale="en" />);
    openSupport();
    await screen.findByText("Windows 11");
    fireEvent.click(
      screen.getByRole("button", { name: "Copy device details" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Device details could not be copied",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open support folder" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "support folder could not be opened",
    );
  });
});
