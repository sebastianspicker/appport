import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import {
  availableApp,
  catalogSnapshot,
  resetNativeMockDefaults,
  signOutOutcome,
} from "../testing/nativeMock";
import { useCatalog } from "../catalog/useCatalog";
import { useConnect, useSignOut } from "./useSession";

vi.mock("../native-bridge/native", async () => {
  const { createNativeMock } = await import("../testing/nativeMock");
  return { native: createNativeMock() };
});

function useSessionHarness() {
  const { catalog, control } = useCatalog("en");
  const connect = useConnect("en", control);
  const signOut = useSignOut("en", control);
  const client = { connect, signOut };
  return { catalog, client, control };
}

async function renderSignedIn() {
  vi.mocked(native.loadCatalog).mockResolvedValue(
    catalogSnapshot([availableApp("old")]),
  );
  const rendered = renderHook(useSessionHarness);
  await waitFor(() =>
    expect(rendered.result.current.catalog.phase).toBe("ready"),
  );
  return rendered;
}

beforeEach(() => resetNativeMockDefaults(vi.mocked(native)));

describe("client session operations", () => {
  it("connects after cancelling prior work and reloads the catalog", async () => {
    vi.mocked(native.connect).mockResolvedValue({
      backgroundCheckRegistered: true,
    });
    const { result } = await renderSignedIn();
    const loadsBefore = vi.mocked(native.loadCatalog).mock.calls.length;
    await act(async () => {
      await result.current.client.connect.connect({
        authMethod: "personal_token",
        relutionUsername: "ada",
        accessToken: "secret",
      });
    });
    expect(result.current.control.currentGeneration()).toBe(1);
    expect(native.connect).toHaveBeenCalledWith({
      authMethod: "personal_token",
      relutionUsername: "ada",
      accessToken: "secret",
    });
    expect(native.loadCatalog).toHaveBeenCalledTimes(loadsBefore + 1);
  });

  it("clears local session state only after native credential removal", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ notificationStateCleared: false }),
    );
    const { result } = await renderSignedIn();
    await act(async () => {
      await result.current.client.signOut.signOut();
    });
    expect(result.current.control.currentGeneration()).toBe(1);
    expect(result.current.catalog.apps).toEqual([]);
    expect(result.current.catalog.bootstrap).toBeUndefined();
    expect(result.current.catalog.phase).toBe("session-expired");
    expect(result.current.client.signOut.signOutWarning).toContain(
      "Signed out locally",
    );
  });

  it("retains the session when the native credential cannot be removed", async () => {
    vi.mocked(native.signOut).mockResolvedValue(
      signOutOutcome({ credentialRemoved: false }),
    );
    const { result } = await renderSignedIn();
    await act(async () => {
      await result.current.client.signOut.signOut();
    });
    expect(result.current.catalog.apps).toHaveLength(1);
    expect(result.current.catalog.bootstrap).toBeDefined();
    expect(result.current.catalog.phase).toBe("ready");
  });

  it("ignores a superseded connect that resolves after a newer one", async () => {
    let resolveFirst: (value: {
      backgroundCheckRegistered: boolean;
    }) => void = () => undefined;
    vi.mocked(native.connect)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ backgroundCheckRegistered: true });
    const { result } = await renderSignedIn();
    const request = {
      authMethod: "personal_token",
      relutionUsername: "ada",
      accessToken: "secret",
    } as const;
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.client.connect.connect(request);
    });
    await act(async () => {
      await result.current.client.connect.connect(request);
    });
    const loadsAfterSecond = vi.mocked(native.loadCatalog).mock.calls.length;
    await act(async () => {
      resolveFirst({ backgroundCheckRegistered: false });
      await first;
    });
    expect(native.loadCatalog).toHaveBeenCalledTimes(loadsAfterSecond);
    expect(
      result.current.client.connect.backgroundCheckWarning,
    ).toBeUndefined();
    expect(result.current.catalog.phase).toBe("ready");
    expect(result.current.catalog.apps).toHaveLength(1);
  });

  it("shows the problem of a failed connect while it is current", async () => {
    vi.mocked(native.connect).mockRejectedValue({
      code: "AUTHORIZATION_DENIED",
      message: "authorization: denied",
    });
    const { result } = await renderSignedIn();
    await act(async () => {
      await result.current.client.connect.connect({
        authMethod: "personal_token",
        relutionUsername: "ada",
        accessToken: "secret",
      });
    });
    expect(result.current.catalog.phase).toBe("authorization-denied");
  });

  it("ignores a connect failure that arrives after a newer operation", async () => {
    let rejectFirst: (reason: unknown) => void = () => undefined;
    vi.mocked(native.connect).mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectFirst = reject;
      }),
    );
    vi.mocked(native.signOut).mockResolvedValue(signOutOutcome());
    const { result } = await renderSignedIn();
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.client.connect.connect({
        authMethod: "personal_token",
        relutionUsername: "ada",
        accessToken: "secret",
      });
    });
    await act(async () => {
      await result.current.client.signOut.signOut();
    });
    expect(result.current.catalog.phase).toBe("session-expired");
    await act(async () => {
      rejectFirst({
        code: "AUTHORIZATION_DENIED",
        message: "authorization: denied",
      });
      await first;
    });
    expect(result.current.catalog.phase).toBe("session-expired");
  });
});
