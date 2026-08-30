import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { problemFor } from "../native-bridge/problem";
import { Status } from "./Status";

describe("Status", () => {
  it("announces loading without a retry", () => {
    render(<Status problem="loading" retry={vi.fn()} locale="en" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("retries recoverable problems", () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(<Status problem="offline" retry={retry} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows administrator guidance for denied authorization", () => {
    expect(problemFor({ code: "AUTHORIZATION_DENIED" })).toBe(
      "authorization-denied",
    );
    render(
      <Status problem="authorization-denied" retry={vi.fn()} locale="en" />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Relution administrator",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
