import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AppAction, AvailableApp } from "../native-bridge/types";
import { ActionSummary } from "./ActionSummary";

function renderSummary(
  state: AppAction["state"],
  options: {
    errorMessage?: string;
    locale?: "de" | "en";
    polling?: "polling";
  } = {},
) {
  const action: AppAction = {
    id: state === "failed" ? "action-43" : "action-42",
    appId: "firefox",
    deviceId: "device",
    intent: "install",
    state,
    errorCode: options.errorMessage ? "DEPLOYMENT" : null,
    errorMessage: options.errorMessage ?? null,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
  const application: AvailableApp = {
    id: "firefox",
    name: "Firefox",
    description: null,
    publisher: null,
    source: "winget",
    packageIdentifier: null,
    releasedVersionId: "128",
    releasedVersionLabel: "128",
    installedVersionId: null,
    installedVersionLabel: null,
    installState: "available",
    activeActionId: action.id,
    activeActionState: state,
    hasIcon: false,
  };
  render(
    <ActionSummary
      action={action}
      application={application}
      locale={options.locale ?? "en"}
      polling={options.polling}
      state={state}
    />,
  );
}

describe("ActionSummary", () => {
  it("announces active actions with labeled indeterminate progress", () => {
    renderSummary("verifying", { polling: "polling" });
    expect(
      screen.getByRole("progressbar", {
        name: "Checking action status: Firefox",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("action-42");
    expect(screen.getByRole("status").textContent).toContain(
      "Verifying installation",
    );
    expect(screen.queryByText(/%/)).toBeNull();
  });
  it("shows localized lifecycle labels and the native failure detail", () => {
    renderSummary("failed", {
      errorMessage: "Deployment service failed.",
      locale: "de",
    });
    expect(screen.getByRole("status").textContent).toContain("Fehlgeschlagen");
    expect(screen.getByRole("alert").textContent).toContain(
      "Deployment service failed.",
    );
  });
});
