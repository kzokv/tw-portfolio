import type { FastifyInstance } from "fastify";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";

const inviteStatusBuckets = new Map<string, number[]>();
const INVITE_STATUS_WINDOW_MS = 60_000;
const INVITE_STATUS_LIMIT = 20;

export function assertInviteStatusRateLimit(ip: string): void {
  const now = Date.now();
  const recent = (inviteStatusBuckets.get(ip) ?? []).filter((timestamp) => now - timestamp < INVITE_STATUS_WINDOW_MS);
  if (recent.length >= INVITE_STATUS_LIMIT) {
    throw routeError(429, "rate_limit_exceeded", "rate limit exceeded");
  }
  recent.push(now);
  inviteStatusBuckets.set(ip, recent);
}

export function _resetInviteStatusBuckets(): void {
  inviteStatusBuckets.clear();
}

export function registerInviteStatusEviction(app: FastifyInstance): void {
  const inviteEvictionTimer = setInterval(
    () => sweepSlidingWindowBucket(inviteStatusBuckets, INVITE_STATUS_WINDOW_MS),
    INVITE_STATUS_WINDOW_MS,
  );
  app.addHook("onClose", async () => { clearInterval(inviteEvictionTimer); });
}
