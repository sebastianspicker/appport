import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalUser } from "@/domain/models";
import {
  MockRelutionGateway,
  resetMockGateway,
} from "./mock-gateway";

const user: PortalUser = {
  id: "mock-user",
  issuer: "urn:appport:mock",
  subject: "mock-user",
  displayName: "Alex Morgan",
  relutionUsername: "alex.morgan",
};

describe("MockRelutionGateway", () => {
  beforeEach(() => {
    resetMockGateway();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns assigned Windows devices and approved installable apps", async () => {
    const gateway = new MockRelutionGateway();
    const devices = await gateway.listAssignedWindowsDevices(user);
    const applications = await gateway.listApplications(
      user,
      "device-office-laptop",
    );

    expect(devices).toHaveLength(2);
    expect(devices.every((device) => device.platform === "WINDOWS")).toBe(true);
    expect(applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "7zip",
          installState: "update_available",
        }),
        expect.objectContaining({
          id: "powertoys",
          installState: "not_installed",
        }),
      ]),
    );
  });

  it("rejects an unassigned device", async () => {
    const gateway = new MockRelutionGateway();
    await expect(
      gateway.listApplications(user, "not-assigned"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deduplicates a repeated request by idempotency key", async () => {
    const gateway = new MockRelutionGateway();
    const first = await gateway.requestAction(
      user,
      "device-office-laptop",
      "7zip",
      "same-request",
    );
    const duplicate = await gateway.requestAction(
      user,
      "device-office-laptop",
      "7zip",
      "same-request",
    );

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.action.id).toBe(first.action.id);
  });

  it("uses truthful queued, sent, verifying, and succeeded states", async () => {
    const gateway = new MockRelutionGateway();
    const { action } = await gateway.requestAction(
      user,
      "device-office-laptop",
      "7zip",
      "normal-action",
    );
    expect(action.state).toBe("queued");

    vi.advanceTimersByTime(1_000);
    expect((await gateway.getAction(user, action.id)).state).toBe("sent");
    vi.advanceTimersByTime(1_000);
    expect((await gateway.getAction(user, action.id)).state).toBe("verifying");
    vi.advanceTimersByTime(2_000);
    expect(await gateway.getAction(user, action.id)).toMatchObject({
      state: "succeeded",
      errorCode: null,
    });
  });

  it("supports installing an approved missing app", async () => {
    const gateway = new MockRelutionGateway();
    const { action } = await gateway.requestAction(
      user,
      "device-office-laptop",
      "powertoys",
      "install-powertoys",
    );
    expect(action.intent).toBe("install");
    vi.advanceTimersByTime(4_000);
    const catalog = await gateway.listApplications(user, action.deviceId);
    expect(catalog.find((app) => app.id === "powertoys")).toMatchObject({
      installState: "installed",
      installedVersionId: "powertoys-0.93.0",
    });
  });

  it("fails VLC once and permits a successful retry", async () => {
    const gateway = new MockRelutionGateway();
    const first = await gateway.requestAction(
      user,
      "device-office-laptop",
      "vlc",
      "first-vlc-attempt",
    );
    vi.advanceTimersByTime(3_000);
    expect(await gateway.getAction(user, first.action.id)).toMatchObject({
      state: "failed",
      errorCode: "INSTALLER_EXIT_CODE",
    });

    const retry = await gateway.requestAction(
      user,
      "device-office-laptop",
      "vlc",
      "retry-vlc",
    );
    expect(retry.action.id).not.toBe(first.action.id);
    vi.advanceTimersByTime(4_000);
    expect(await gateway.getAction(user, retry.action.id)).toMatchObject({
      state: "succeeded",
    });
  });

  it("does not expose actions owned by another subject", async () => {
    const gateway = new MockRelutionGateway();
    const { action } = await gateway.requestAction(
      user,
      "device-office-laptop",
      "firefox",
      "owned-action",
    );

    await expect(
      gateway.getAction(
        { ...user, id: "other", subject: "other-user" },
        action.id,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
