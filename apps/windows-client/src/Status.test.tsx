import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Status } from "./Status";

describe("Status", () => {
  it("announces loading without offering a retry", () => {
    render(<Status problem="loading" retry={vi.fn()} locale="en" />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("retries a recoverable problem", () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(<Status problem="offline" retry={retry} locale="en" />);

    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
