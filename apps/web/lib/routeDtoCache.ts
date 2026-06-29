import type { RouteCachePolicyDto } from "@vakwen/shared-types";
import { readContextCookie } from "./context";

const CACHE_VERSION = "2026-06-14-market-value-reconciliation-ux-v1";
const KEY_PREFIX = "vakwen:route-dto-cache";
const DEFAULT_TTL_MS = 3 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 10 * 60 * 1000;
export const PORTFOLIO_CONTEXT_ROUTE_CACHE_TAGS = [
  buildRouteDtoCacheTag("route", "dashboard-primary"),
  buildRouteDtoCacheTag("route", "dashboard-performance"),
  buildRouteDtoCacheTag("route", "portfolio-primary"),
  buildRouteDtoCacheTag("route", "reports"),
  buildRouteDtoCacheTag("route", "analysis-unrealized-pnl"),
  buildRouteDtoCacheTag("route", "transactions-primary"),
] as const;

export type RouteDtoCacheStatus = "fresh" | "stale";

interface CacheEnvelope<T> {
  createdAt: number;
  payload: T;
  staleUntilAt: number;
  tags: string[];
  ttlMs: number;
  version: string;
}

export interface RouteDtoCacheReadResult<T> {
  createdAt: number;
  payload: T;
  savedAt: number;
  staleUntilAt: number;
  status: RouteDtoCacheStatus;
  ttlMs: number;
}

export interface RouteDtoCacheWriteOptions {
  staleTtlMs?: number;
  tags?: string[];
  ttlMs?: number;
}

export type RouteDtoCachePolicySlot =
  | "dashboard-primary"
  | "dashboard-enrichment"
  | "dashboard-performance"
  | "portfolio-primary"
  | "analysis-unrealized-pnl"
  | "reports"
  | "transactions-primary";

export interface RouteDtoCacheDurations {
  staleTtlMs: number;
  ttlMs: number;
}

let didClearLegacyLocalStorage = false;

function clearLegacyLocalStorageRouteDtoKeys(): void {
  if (typeof window === "undefined" || didClearLegacyLocalStorage) return;
  didClearLegacyLocalStorage = true;

  try {
    const storage = window.localStorage;
    const keysToDelete: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(KEY_PREFIX)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      storage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable in private mode; ignore.
  }
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  clearLegacyLocalStorageRouteDtoKeys();
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function buildRouteDtoCacheKey(...parts: Array<string | number | null | undefined | false>): string {
  const normalized = parts
    .filter((part): part is string | number => part !== null && part !== undefined && part !== false)
    .map((part) => String(part).trim())
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part));
  return [KEY_PREFIX, ...normalized].join(":");
}

export function buildRouteDtoCacheTag(tag: string, value?: string | null): string {
  const normalizedTag = tag.trim();
  if (normalizedTag.length === 0) return "";
  const normalizedValue = value?.trim();
  return normalizedValue ? `${normalizedTag}:${normalizedValue}` : normalizedTag;
}

export function getRouteDtoContextScope(sessionUserId?: string | null): string {
  const ownerScope = readContextCookie() ?? "self";
  const sessionScope = sessionUserId?.trim() || "unknown";
  return `session:${sessionScope}:context:${ownerScope}`;
}

export function readRouteDtoCache<T>(
  key: string,
  options: { allowStale?: boolean; maxAgeMs?: number } = {},
): RouteDtoCacheReadResult<T> | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (
      !parsed
      || parsed.version !== CACHE_VERSION
      || typeof parsed.createdAt !== "number"
      || typeof parsed.ttlMs !== "number"
      || typeof parsed.staleUntilAt !== "number"
      || !Array.isArray(parsed.tags)
    ) {
      storage.removeItem(key);
      return null;
    }

    const now = Date.now();
    if (typeof options.maxAgeMs === "number" && options.maxAgeMs > 0 && now - parsed.createdAt > options.maxAgeMs) {
      return null;
    }
    if (parsed.staleUntilAt <= now) {
      storage.removeItem(key);
      return null;
    }

    const savedAt = parsed.createdAt + parsed.ttlMs;
    const status: RouteDtoCacheStatus = savedAt > now ? "fresh" : "stale";
    if (status === "stale" && options.allowStale === false) {
      return null;
    }

    return {
      createdAt: parsed.createdAt,
      payload: parsed.payload,
      savedAt: parsed.createdAt,
      staleUntilAt: parsed.staleUntilAt,
      status,
      ttlMs: parsed.ttlMs,
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeRouteDtoCache<T>(
  key: string,
  payload: T,
  options: number | RouteDtoCacheWriteOptions = DEFAULT_TTL_MS,
): void {
  const storage = getStorage();
  if (!storage) return;

  const normalizedOptions = typeof options === "number"
    ? { ttlMs: options }
    : options;
  const ttlMs = clampPositiveDuration(normalizedOptions.ttlMs ?? DEFAULT_TTL_MS);
  const staleTtlMs = clampPositiveDuration(normalizedOptions.staleTtlMs ?? DEFAULT_STALE_TTL_MS);
  const tags = Array.from(new Set((normalizedOptions.tags ?? []).filter((tag) => tag.trim().length > 0)));

  try {
    const now = Date.now();
    const envelope: CacheEnvelope<T> = {
      createdAt: now,
      payload,
      staleUntilAt: now + Math.max(ttlMs, staleTtlMs),
      tags,
      ttlMs,
      version: CACHE_VERSION,
    };
    storage.setItem(key, JSON.stringify(envelope));
  } catch {
    // sessionStorage quota/privacy failures should not break page rendering.
  }
}

export function clearRouteDtoCacheByPrefix(prefix: string): void {
  clearRouteDtoCacheWhere((key) => key.startsWith(prefix));
}

export function clearRouteDtoCacheByTags(tags: string[]): void {
  const normalizedTags = new Set(tags.filter((tag) => tag.trim().length > 0));
  if (normalizedTags.size === 0) return;

  clearRouteDtoCacheWhere((_key, parsed) =>
    Array.isArray(parsed?.tags) && parsed.tags.some((tag: string) => normalizedTags.has(tag)),
  );
}

export function clearPortfolioContextRouteCaches(): void {
  clearRouteDtoCacheByTags([...PORTFOLIO_CONTEXT_ROUTE_CACHE_TAGS]);
}

export function getRouteDtoCachePrefix(): string {
  return KEY_PREFIX;
}

export function resolveRouteDtoCacheDurations(
  policy: RouteCachePolicyDto | null | undefined,
  slot: RouteDtoCachePolicySlot,
): RouteDtoCacheDurations {
  if (!policy) {
    return {
      staleTtlMs: DEFAULT_STALE_TTL_MS,
      ttlMs: defaultTtlForSlot(slot),
    };
  }

  return {
    staleTtlMs: clampPositiveDuration(policy.staleUsableTtlMs),
    ttlMs: clampPositiveDuration(ttlForPolicySlot(policy, slot)),
  };
}

function clearRouteDtoCacheWhere(
  predicate: (key: string, parsed?: CacheEnvelope<unknown>) => boolean,
): void {
  const storage = getStorage();
  if (!storage) return;

  const keysToDelete: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    let parsed: CacheEnvelope<unknown> | undefined;
    try {
      const raw = storage.getItem(key);
      parsed = raw ? JSON.parse(raw) as CacheEnvelope<unknown> : undefined;
    } catch {
      parsed = undefined;
    }
    if (predicate(key, parsed)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    storage.removeItem(key);
  }
}

function clampPositiveDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TTL_MS;
}

function defaultTtlForSlot(slot: RouteDtoCachePolicySlot): number {
  switch (slot) {
    case "dashboard-primary":
    case "dashboard-enrichment":
    case "portfolio-primary":
    case "transactions-primary":
      return 120_000;
    case "dashboard-performance":
    case "analysis-unrealized-pnl":
    case "reports":
      return 300_000;
  }
}

function ttlForPolicySlot(policy: RouteCachePolicyDto, slot: RouteDtoCachePolicySlot): number {
  switch (slot) {
    case "dashboard-primary":
      return policy.dashboardPrimaryTtlMs;
    case "dashboard-enrichment":
      return policy.dashboardEnrichmentTtlMs;
    case "dashboard-performance":
      return policy.dashboardPerformanceTtlMs;
    case "portfolio-primary":
    case "transactions-primary":
      return policy.portfolioTtlMs;
    case "reports":
    case "analysis-unrealized-pnl":
      return policy.reportsTtlMs;
  }
}
