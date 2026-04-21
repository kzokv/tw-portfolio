import type { FastifyInstance } from "fastify";
import { Env } from "@tw-portfolio/config";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";

// KZO-147: per-IP rate limit on GET /share/:token. Counts invalid tokens too
// (enumeration resistance). Checked BEFORE DB lookup so brute-forcers cannot
// burn persistence throughput. See docs/004-notes/kzo-147/ Q4.
const anonymousShareRateBuckets = new Map<string, number[]>();

export function assertAnonymousShareRateLimit(ip: string): void {
  const now = Date.now();
  const windowMs = Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS;
  const limit = Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX;
  const recent = (anonymousShareRateBuckets.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < windowMs,
  );
  if (recent.length >= limit) {
    throw routeError(429, "rate_limit_exceeded", "rate limit exceeded");
  }
  recent.push(now);
  anonymousShareRateBuckets.set(ip, recent);
}

export function _resetAnonymousShareRateBuckets(): void {
  anonymousShareRateBuckets.clear();
}

export function deleteAnonymousShareRateBucket(ip: string): void {
  anonymousShareRateBuckets.delete(ip);
}

export function registerAnonymousShareEviction(app: FastifyInstance): void {
  const windowMs = Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS;
  const anonEvictionTimer = setInterval(
    () => sweepSlidingWindowBucket(anonymousShareRateBuckets, windowMs),
    windowMs,
  );
  app.addHook("onClose", async () => { clearInterval(anonEvictionTimer); });
}
