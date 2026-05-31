import type { FastifyInstance } from "fastify";
import { Env } from "@vakwen/config";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";
import {
  getEffectiveAnonymousShareRateLimitMax,
  getEffectiveAnonymousShareRateLimitWindowMs,
} from "../services/appConfig/sharing.js";

// KZO-147: per-IP rate limit on GET /share/:token. Counts invalid tokens too
// (enumeration resistance). Checked BEFORE DB lookup so brute-forcers cannot
// burn persistence throughput. See docs/004-notes/kzo-147/ Q4.
//
// KZO-199 (per `.claude/rules/fastify-eviction-lifecycle-pattern.md` § "schedule
// static, parameter live"): per-request limit/window are read LIVE from the
// resolver so admin PATCHes take effect on the next call. Eviction sweep
// cadence stays env-default (registration-time capture) — the rule's
// schedule-static contract.
const anonymousShareRateBuckets = new Map<string, number[]>();

export function assertAnonymousShareRateLimit(ip: string): void {
  const now = Date.now();
  const windowMs = getEffectiveAnonymousShareRateLimitWindowMs();
  const limit = getEffectiveAnonymousShareRateLimitMax();
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
  // Schedule cadence — captured once at registration (env default). Admin
  // PATCHes that extend the window only take effect on the per-request check.
  const cadenceMs = Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS;
  const anonEvictionTimer = setInterval(
    // Sweep parameter — read LIVE so an admin-extended window keeps in-flight
    // entries until they actually expire (KZO-198 §1 fastify-eviction rule).
    () => sweepSlidingWindowBucket(anonymousShareRateBuckets, getEffectiveAnonymousShareRateLimitWindowMs()),
    cadenceMs,
  );
  app.addHook("onClose", async () => { clearInterval(anonEvictionTimer); });
}
