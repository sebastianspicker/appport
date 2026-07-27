import { GatewayError } from "./errors";

interface Bucket {
  startedAt: number;
  count: number;
}

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly message = "Too many update requests. Try again shortly.",
    private readonly maximumBuckets = 10_000,
  ) {}

  assertAllowed(key: string, now = Date.now()) {
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      if (!bucket && this.buckets.size >= this.maximumBuckets) {
        for (const [candidateKey, candidate] of this.buckets) {
          if (now - candidate.startedAt >= this.windowMs) {
            this.buckets.delete(candidateKey);
          }
        }
        if (this.buckets.size >= this.maximumBuckets) {
          throw new GatewayError("RATE_LIMITED", this.message);
        }
      }
      this.buckets.set(key, { startedAt: now, count: 1 });
      return;
    }

    if (bucket.count >= this.limit) {
      throw new GatewayError(
        "RATE_LIMITED",
        this.message,
      );
    }

    bucket.count += 1;
  }

  reset() {
    this.buckets.clear();
  }
}
