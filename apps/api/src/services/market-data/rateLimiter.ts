/**
 * In-memory sliding window rate limiter for FinMind API.
 * Budget: 600 requests/hour. Resets on server restart (acceptable for phase 1).
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface TimestampedRequest {
  timestamp: number;
}

export class RateLimiter {
  private readonly budget: number | (() => number);
  private readonly windowMs: number;
  private requests: TimestampedRequest[] = [];

  constructor(budget: number | (() => number) = 600, windowMs: number = WINDOW_MS) {
    this.budget = budget;
    this.windowMs = windowMs;
  }

  private currentBudget(): number {
    const budget = typeof this.budget === "function" ? this.budget() : this.budget;
    if (!Number.isFinite(budget)) return 1;
    return Math.max(1, Math.floor(budget));
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((r) => r.timestamp > cutoff);
  }

  /** Check if budget allows N requests. */
  canConsume(n: number): boolean {
    const now = Date.now();
    this.evictExpired(now);
    return this.requests.length + n <= this.currentBudget();
  }

  /** Decrement budget by N requests. Call only after canConsume(n) returns true. */
  consume(n: number): void {
    const now = Date.now();
    this.evictExpired(now);
    for (let i = 0; i < n; i++) {
      this.requests.push({ timestamp: now });
    }
  }

  /** Time in ms until N requests become available. Returns 0 if already available. */
  msUntilAvailable(n: number): number {
    const now = Date.now();
    this.evictExpired(now);

    const available = this.currentBudget() - this.requests.length;
    if (available >= n) return 0;

    // Need to wait for oldest requests to expire
    const needToFree = n - available;
    // Sort ascending (oldest first) — already in order since we push chronologically
    const targetRequest = this.requests[needToFree - 1];
    if (!targetRequest) return 0;

    const expiresAt = targetRequest.timestamp + this.windowMs;
    return Math.max(0, expiresAt - now);
  }

  /** Reset all state. Exposed for testing. */
  _reset(): void {
    this.requests = [];
  }

  /** Current number of requests consumed in the window. */
  get consumed(): number {
    this.evictExpired(Date.now());
    return this.requests.length;
  }
}
