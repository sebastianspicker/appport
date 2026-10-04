import { describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import type { AppAction } from "../native-bridge/types";
import { deferred } from "../testing/nativeMock";
import { HydrationPool } from "./hydrationPool";

vi.mock("../native-bridge/native", () => ({ native: { action: vi.fn() } }));
describe("action hydration pool", () => {
  it("bounds overlapping batches to four and discards cancelled queued reads", async () => {
    const pending = deferred<AppAction>();
    vi.mocked(native.action).mockReset().mockReturnValue(pending.promise);
    const pool = new HydrationPool();
    let current = true;
    const initial = Array.from({ length: 6 }, (_, index) =>
      pool.load(`old-${index}`, () => current),
    );
    expect(native.action).toHaveBeenCalledTimes(4);
    current = false;
    const next = pool.load("new", () => true);
    pending.resolve({ id: "result" } as AppAction);
    const result = await Promise.all([...initial, next]);
    expect(native.action).toHaveBeenCalledTimes(5);
    expect(native.action).toHaveBeenLastCalledWith("new");
    expect(result.slice(4, 6)).toEqual([undefined, undefined]);
  });
  it("drops queued work on reset without releasing still-active slots early", async () => {
    const pending = deferred<AppAction>();
    vi.mocked(native.action).mockReset().mockReturnValue(pending.promise);
    const pool = new HydrationPool();
    const reads = Array.from({ length: 5 }, (_, index) =>
      pool.load(`${index}`, () => true),
    );
    pool.clear();
    const next = pool.load("new-session", () => true);
    expect(native.action).toHaveBeenCalledTimes(4);
    pending.resolve({ id: "result" } as AppAction);
    await Promise.all([...reads, next]);
    expect(native.action).toHaveBeenCalledTimes(5);
    expect(await reads[4]).toBeUndefined();
  });
});
