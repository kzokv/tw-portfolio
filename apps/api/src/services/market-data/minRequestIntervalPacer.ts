export class MinRequestIntervalPacer {
  private readonly minIntervalMs: number | (() => number);
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  constructor(minIntervalMs: number | (() => number)) {
    this.minIntervalMs = minIntervalMs;
  }

  private currentInterval(): number {
    const value = typeof this.minIntervalMs === "function" ? this.minIntervalMs() : this.minIntervalMs;
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }

  async waitTurn(): Promise<void> {
    const run = this.tail.then(async () => {
      const intervalMs = this.currentInterval();
      if (intervalMs <= 0) {
        this.nextAllowedAt = Date.now();
        return;
      }
      const now = Date.now();
      const waitMs = Math.max(0, this.nextAllowedAt - now);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.nextAllowedAt = Date.now() + intervalMs;
    });
    this.tail = run.catch(() => {});
    await run;
  }
}
