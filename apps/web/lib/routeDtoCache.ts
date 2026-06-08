"use client";

import { readContextCookie } from "./context";

const CACHE_VERSION = "2026-06-08-dashboard-reporting-ui-v1";
const KEY_PREFIX = "vakwen:route-dto-cache";
const DEFAULT_TTL_MS = 3 * 60 * 1000;

interface CacheEnvelope<T> {
  expiresAt: number;
  payload: T;
  savedAt: number;
  version: string;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
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

export function getRouteDtoContextScope(): string {
  return readContextCookie() ?? "self";
}

export function readRouteDtoCache<T>(key: string): { payload: T; savedAt: number } | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (
      !parsed
      || parsed.version !== CACHE_VERSION
      || typeof parsed.savedAt !== "number"
      || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt <= Date.now()
    ) {
      storage.removeItem(key);
      return null;
    }
    return { payload: parsed.payload, savedAt: parsed.savedAt };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeRouteDtoCache<T>(key: string, payload: T, ttlMs = DEFAULT_TTL_MS): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    const now = Date.now();
    const envelope: CacheEnvelope<T> = {
      expiresAt: now + ttlMs,
      payload,
      savedAt: now,
      version: CACHE_VERSION,
    };
    storage.setItem(key, JSON.stringify(envelope));
  } catch {
    // localStorage quota/privacy failures should not break page rendering.
  }
}

export function clearRouteDtoCacheByPrefix(prefix: string): void {
  const storage = getStorage();
  if (!storage) return;

  const keysToDelete: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    storage.removeItem(key);
  }
}

export function getRouteDtoCachePrefix(): string {
  return KEY_PREFIX;
}
