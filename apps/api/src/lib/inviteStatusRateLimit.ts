import type { FastifyInstance } from "fastify";
import { Env } from "@tw-portfolio/config";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";
import {
  getEffectiveInviteStatusWindowMs,
  getEffectiveInviteStatusLimit,
} from "../services/appConfig/rateLimits.js";

const inviteStatusBuckets = new Map<string, number[]>();

export function assertInviteStatusRateLimit(ip: string): void {
  // KZO-198: read window+limit live (DB override → env).
  const windowMs = getEffectiveInviteStatusWindowMs();
  const limit = getEffectiveInviteStatusLimit();
  const now = Date.now();
  const recent = (inviteStatusBuckets.get(ip) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    throw routeError(429, "rate_limit_exceeded", "rate limit exceeded");
  }
  recent.push(now);
  inviteStatusBuckets.set(ip, recent);
}

export function _resetInviteStatusBuckets(): void {
  inviteStatusBuckets.clear();
}

export function registerInviteStatusEviction(app: FastifyInstance): void {
  // KZO-198 / fastify-eviction-lifecycle-pattern.md: cadence (interval arg)
  // stays at env. Sweep CALLBACK reads effective window — see peer
  // `marketDataPriceRateLimit.ts` for the full rationale.
  const inviteEvictionTimer = setInterval(
    () => sweepSlidingWindowBucket(inviteStatusBuckets, getEffectiveInviteStatusWindowMs()),
    Env.INVITE_STATUS_WINDOW_MS,
  );
  app.addHook("onClose", async () => { clearInterval(inviteEvictionTimer); });
}
