import { describe, expect, it } from "vitest";
import { POST as mockSignIn } from "@/app/api/auth/mock/sign-in/route";

const requestId = "7be8b295-5087-42b9-bfb2-68de9e86baf7";
const value32 = "A".repeat(43);
const returnTo =
  `/native/connect?requestId=${requestId}` +
  `&challenge=${value32}&state=${value32}&port=49152`;

function request(value: string, origin = "http://localhost") {
  return new Request("http://localhost/api/auth/mock/sign-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
    },
    body: new URLSearchParams({ returnTo: value }),
  });
}

describe("native browser handoff", () => {
  it("returns mock authentication only to a validated native connect path", async () => {
    const response = await mockSignIn(request(returnTo));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`http://localhost${returnTo}`);
    expect(response.headers.get("set-cookie")).toContain(
      "appport-mock-session=",
    );
  });

  it("falls back to the handoff page for a non-native return path", async () => {
    const response = await mockSignIn(request("/apps"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("rejects cross-origin mock authentication", async () => {
    const response = await mockSignIn(request(returnTo, "https://attacker.test"));
    expect(response.status).toBe(403);
  });
});
