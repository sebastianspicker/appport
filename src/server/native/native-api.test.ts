import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PortalUser } from "@/domain/models";
import { GET as getAction } from "@/app/api/native/actions/[actionId]/route";
import { POST as postAction } from "@/app/api/native/apps/[appId]/actions/route";
import { GET as getIcon } from "@/app/api/native/apps/[appId]/icon/route";
import { GET as getApps } from "@/app/api/native/apps/route";
import { GET as getBootstrap } from "@/app/api/native/bootstrap/route";
import { GET as getInstalled } from "@/app/api/native/installed/route";
import { DELETE as deleteSession } from "@/app/api/native/session/route";
import { POST as exchangeSession } from "@/app/api/native/session/exchange/route";
import { GET as getUpdates } from "@/app/api/native/updates/route";
import { closeActionRepository, getActionRepository } from "@/server/persistence/runtime";
import { resetMockGateway } from "@/server/relution/mock-gateway";
import { resetNativeRateLimitsForTests } from "./rate-limit";
import {
  hashNativeSecret,
  verifierChallenge,
} from "./validation";

const owner: PortalUser = {
  id: "mock-user",
  issuer: "urn:appport:mock",
  subject: "mock-user",
  displayName: "Alex Morgan",
  relutionUsername: "alex.morgan",
};

let directory: string;
const requestId = "7be8b295-5087-42b9-bfb2-68de9e86baf7";
const verifier = "A".repeat(43);
const code = "B".repeat(43);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "native-api-"));
  process.env.RELUTION_GATEWAY_MODE = "mock";
  process.env.APPPORT_SQLITE_PATH = join(directory, "appport.sqlite");
  resetMockGateway();
  resetNativeRateLimitsForTests();
});

afterEach(() => {
  closeActionRepository();
  delete process.env.APPPORT_SQLITE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

async function createNativeSession() {
  const repository = getActionRepository();
  repository.createNativeAuthRequest({
    requestId,
    challenge: verifierChallenge(verifier),
    stateHash: hashNativeSecret("C".repeat(43)),
    loopbackPort: 49152,
  });
  expect(
    repository.authorizeNativeAuthRequest(
      requestId,
      owner,
      hashNativeSecret(code),
    ),
  ).not.toBeNull();

  const exchange = await exchangeSession(
    new Request("http://localhost/api/native/session/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        code,
        verifier,
        clientVersion: "0.1.0",
        locale: "en-US",
        deviceEvidence: {
          version: 1,
          hostname: "OFFICE-LAPTOP",
          entDmid: "6b29fc40-ca47-1067-b31d-00dd010662da",
        },
      }),
    }),
  );
  expect(exchange.status).toBe(201);
  const session = (await exchange.json()) as {
    token: string;
    expiresAt: string;
  };
  expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return session;
}

describe("native API session", () => {
  it("exchanges a one-time browser grant for a bound bearer session", async () => {
    const session = await createNativeSession();

    const replay = await exchangeSession(
      new Request("http://localhost/api/native/session/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          code,
          verifier,
          clientVersion: "0.1.0",
          locale: "en-US",
          deviceEvidence: {
            version: 1,
            hostname: "OFFICE-LAPTOP",
            entDmid: "6b29fc40-ca47-1067-b31d-00dd010662da",
          },
        }),
      }),
    );
    expect(replay.status).toBe(401);

    const authorization = { Authorization: `Bearer ${session.token}` };
    const bootstrap = await getBootstrap(
      new Request("http://localhost/api/native/bootstrap", {
        headers: authorization,
      }),
    );
    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({
      user: { displayName: "Alex Morgan" },
      device: { name: "Office Laptop" },
      updateCount: 3,
    });

    expect(
      (
        await deleteSession(
          new Request("http://localhost/api/native/session", {
            method: "DELETE",
            headers: authorization,
          }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await getBootstrap(
          new Request("http://localhost/api/native/bootstrap", {
            headers: authorization,
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("serves only the bound device catalog and action surface", async () => {
    const session = await createNativeSession();
    const authorization = { Authorization: `Bearer ${session.token}` };

    const apps = await getApps(
      new Request("http://localhost/api/native/apps", {
        headers: authorization,
      }),
    );
    expect(apps.status).toBe(200);
    await expect(apps.json()).resolves.toMatchObject({
      applications: expect.arrayContaining([
        expect.objectContaining({ id: "7zip", installState: "update_available" }),
        expect.objectContaining({ id: "powertoys", installState: "not_installed" }),
      ]),
    });

    const updates = await getUpdates(
      new Request("http://localhost/api/native/updates", {
        headers: authorization,
      }),
    );
    expect(updates.status).toBe(200);
    expect(
      ((await updates.json()) as { applications: unknown[] }).applications,
    ).toHaveLength(3);

    const installed = await getInstalled(
      new Request("http://localhost/api/native/installed", {
        headers: authorization,
      }),
    );
    expect(installed.status).toBe(200);
    expect(
      ((await installed.json()) as { applications: unknown[] }).applications,
    ).toHaveLength(4);

    expect(
      (
        await getIcon(
          new Request("http://localhost/api/native/apps/7zip/icon", {
            headers: authorization,
          }),
          { params: Promise.resolve({ appId: "7zip" }) },
        )
      ).status,
    ).toBe(404);

    const actionResponse = await postAction(
      new Request("http://localhost/api/native/apps/7zip/actions", {
        method: "POST",
        headers: {
          ...authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "d9428888-122b-4b85-b7a7-36f4d756d488",
        }),
      }),
      { params: Promise.resolve({ appId: "7zip" }) },
    );
    expect(actionResponse.status).toBe(202);
    const action = (await actionResponse.json()) as {
      action: { id: string; appId: string; deviceId: string };
    };
    expect(action.action).toMatchObject({
      appId: "7zip",
      deviceId: "device-office-laptop",
    });

    const status = await getAction(
      new Request(
        `http://localhost/api/native/actions/${action.action.id}`,
        { headers: authorization },
      ),
      { params: Promise.resolve({ actionId: action.action.id }) },
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      action: {
        id: action.action.id,
        appId: "7zip",
        deviceId: "device-office-laptop",
      },
    });

    expect(
      (
        await getApps(
          new Request("http://localhost/api/native/apps", {
            headers: { Authorization: `Bearer ${"Z".repeat(43)}` },
          }),
        )
      ).status,
    ).toBe(401);
  });
});
