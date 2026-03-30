function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sliding-window limiter used for HubSpot's 100 requests / 10 seconds API quota.
 */
export class SlidingWindowRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  async waitTurn(): Promise<void> {
    while (true) {
      const now = Date.now();
      while (
        this.timestamps.length > 0 &&
        now - this.timestamps[0] >= this.windowMs
      ) {
        this.timestamps.shift();
      }

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      const oldest = this.timestamps[0];
      const waitMs = Math.max(1, this.windowMs - (now - oldest));
      await sleep(waitMs);
    }
  }
}
