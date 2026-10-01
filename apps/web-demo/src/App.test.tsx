import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.lang = "en";
});

describe("interactive demo", () => {
  it("labels synthetic data and exposes no credential UI", () => {
    const { container } = render(<App />);
    expect(screen.getByText(/synthetic catalog data/i)).toBeTruthy();
    expect(screen.getAllByText("DEMO-PC-047")).toHaveLength(2);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('input[name*="token" i]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: /sign in|connect/i }),
    ).toBeNull();
  });

  it("switches views and filters the catalog", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /updates \(2\)/i }));
    expect(screen.getByRole("heading", { name: "Canvas Pro" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search software"), {
      target: { value: "Reporter" },
    });
    expect(screen.getByRole("heading", { name: "Reporter" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Canvas Pro" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Source"), {
      target: { value: "winget" },
    });
    expect(screen.getByText(/No software matches/i)).toBeTruthy();
  });

  it("confirms a simulated action, reports progress, and removes completion", () => {
    vi.useFakeTimers();
    render(<App />);
    const drawpad = screen
      .getByRole("heading", { name: "Drawpad" })
      .closest("article");
    expect(drawpad).not.toBeNull();
    fireEvent.click(
      within(drawpad as HTMLElement).getByRole("button", { name: "Install" }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("Verifying installation")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_400));
    expect(screen.getByText("Succeeded")).toBeTruthy();
    act(() => vi.advanceTimersByTime(900));
    expect(screen.queryByRole("heading", { name: "Drawpad" })).toBeNull();
  });

  it("keeps an unknown action locked without a retry control", () => {
    render(<App />);
    const card = screen
      .getByRole("heading", { name: "Archive Room" })
      .closest("article");
    expect(card?.textContent).toContain("Locked for review");
    expect(card?.querySelector("button")).toBeNull();
  });

  it("cancels the modal without starting an action and restores focus", () => {
    render(<App />);
    const drawpad = screen
      .getByRole("heading", { name: "Drawpad" })
      .closest("article");
    const install = within(drawpad as HTMLElement).getByRole("button", {
      name: "Install",
    });
    install.focus();
    fireEvent.click(install);
    expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.activeElement).toBe(install);
  });

  it("renders the complete demo chrome in German", () => {
    const language = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("de-DE");
    render(<App />);
    expect(
      screen.getByRole("navigation", { name: "Softwareansichten" }),
    ).toBeTruthy();
    expect(screen.getByText("Freigegebene Software")).toBeTruthy();
    expect(screen.getByText(/Projektnotizen offline erfassen/)).toBeTruthy();
    expect(document.documentElement.lang).toBe("de");
    language.mockRestore();
  });
});
