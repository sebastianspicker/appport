import { beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../native-bridge/native";
import {
  resetIconSession,
  setIconCatalogRevision,
  subscribeIcon,
} from "./iconPool";

vi.mock("../native-bridge/native", () => ({ native: { icon: vi.fn() } }));
async function read(appId: string) {
  let release = () => {};
  const value = await new Promise<string | null>((resolve) => {
    release = subscribeIcon(appId, "pool-1", resolve);
  });
  release();
  // Let the native promise's finally release its slot before the next subscription.
  await Promise.resolve();
  return value;
}
beforeEach(() => {
  resetIconSession();
  setIconCatalogRevision("pool-1");
  vi.resetAllMocks();
});
describe("icon cache", () => {
  it("caches missing icons but retries transient errors", async () => {
    vi.mocked(native.icon).mockResolvedValue(null);
    await read("missing");
    await read("missing");
    expect(native.icon).toHaveBeenCalledTimes(1);
    vi.mocked(native.icon)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("image");
    await read("retry");
    await read("retry");
    expect(native.icon).toHaveBeenCalledTimes(3);
  });
  it("evicts the least recently used entry after 256 entries", async () => {
    vi.mocked(native.icon).mockResolvedValue(null);
    for (let index = 0; index < 256; index += 1) await read(`entry-${index}`);
    await read("entry-0");
    await read("overflow");
    await read("entry-0");
    expect(native.icon).toHaveBeenCalledTimes(257);
    await read("entry-1");
    expect(native.icon).toHaveBeenCalledTimes(258);
  });
  it("evicts retained data URLs before exceeding 32 MiB", async () => {
    vi.mocked(native.icon).mockResolvedValue("x".repeat(9 * 1024 * 1024));
    await read("large-first");
    await read("large-second");
    await read("large-first");
    expect(native.icon).toHaveBeenCalledTimes(3);
  });
  it("clears missing-icon cache across catalog revisions and sessions", async () => {
    vi.mocked(native.icon).mockResolvedValue(null);
    await read("missing");
    resetIconSession();
    await read("missing");
    expect(native.icon).toHaveBeenCalledTimes(2);
    setIconCatalogRevision("pool-2");
    await new Promise((resolve) => subscribeIcon("missing", "pool-2", resolve));
    expect(native.icon).toHaveBeenCalledTimes(3);
  });
});
