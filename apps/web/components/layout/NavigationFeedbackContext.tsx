"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface NavigationFeedbackState {
  isPending: boolean;
  pendingHref: string | null;
  pendingLabel: string | null;
  startNavigation: (input: { href: string; label: string }) => void;
  clearNavigation: () => void;
}

interface PendingNavigation {
  href: string;
  label: string;
  startedAt: number;
}

const MIN_VISIBLE_MS = 350;
const MAX_PENDING_MS = 8_000;
const STORAGE_KEY = "vakwen.pendingNavigation";

const NavigationFeedbackContext = createContext<NavigationFeedbackState | null>(null);

export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const pathnameRef = useRef(pathname);
  const clearTimerRef = useRef<number | null>(null);
  const maxPendingTimerRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (maxPendingTimerRef.current !== null) {
      window.clearTimeout(maxPendingTimerRef.current);
      maxPendingTimerRef.current = null;
    }
    clearStoredNavigation();
    setPending(null);
  }, []);

  const startNavigation = useCallback((input: { href: string; label: string }) => {
    const nextPath = resolvePathname(input.href);
    if (!nextPath || nextPath === pathnameRef.current) return;
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (maxPendingTimerRef.current !== null) {
      window.clearTimeout(maxPendingTimerRef.current);
      maxPendingTimerRef.current = null;
    }
    setPending({
      href: nextPath,
      label: input.label,
      startedAt: performance.now(),
    });
    storeNavigation({ href: nextPath, label: input.label });
    maxPendingTimerRef.current = window.setTimeout(() => {
      maxPendingTimerRef.current = null;
      clearStoredNavigation();
      setPending(null);
    }, MAX_PENDING_MS);
  }, []);

  useEffect(() => {
    if (pending) return;
    const stored = readStoredNavigation();
    if (!stored || stored.href !== pathname) return;

    if (Date.now() - stored.createdAt > MAX_PENDING_MS) {
      clearStoredNavigation();
      return;
    }

    setPending({
      href: stored.href,
      label: stored.label,
      startedAt: performance.now(),
    });
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      clearStoredNavigation();
      setPending(null);
    }, MIN_VISIBLE_MS);
  }, [pathname, pending]);

  useEffect(() => {
    const previousPath = pathnameRef.current;
    pathnameRef.current = pathname;
    if (!pending || pathname === previousPath) return;
    if (maxPendingTimerRef.current !== null) {
      window.clearTimeout(maxPendingTimerRef.current);
      maxPendingTimerRef.current = null;
    }

    const elapsed = performance.now() - pending.startedAt;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (remaining === 0) {
      clearPending();
      return;
    }

    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      setPending(null);
    }, remaining);
  }, [clearPending, pathname, pending]);

  useEffect(() => () => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
    if (maxPendingTimerRef.current !== null) {
      window.clearTimeout(maxPendingTimerRef.current);
    }
  }, []);

  const value = useMemo<NavigationFeedbackState>(
    () => ({
      isPending: pending !== null,
      pendingHref: pending?.href ?? null,
      pendingLabel: pending?.label ?? null,
      startNavigation,
      clearNavigation: clearPending,
    }),
    [clearPending, pending, startNavigation],
  );

  return (
    <NavigationFeedbackContext.Provider value={value}>
      {children}
    </NavigationFeedbackContext.Provider>
  );
}

export function useNavigationFeedback() {
  const value = useContext(NavigationFeedbackContext);
  if (!value) {
    throw new Error("useNavigationFeedback must be used within NavigationFeedbackProvider");
  }
  return value;
}

export function useOptionalNavigationFeedback() {
  return useContext(NavigationFeedbackContext);
}

function resolvePathname(href: string): string | null {
  try {
    return new URL(href, window.location.href).pathname;
  } catch {
    return null;
  }
}

function storeNavigation(input: { href: string; label: string }): void {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...input, createdAt: Date.now() }),
    );
  } catch {
    // Storage access can fail in hardened browser contexts; visual feedback
    // still works for the current shell instance.
  }
}

function readStoredNavigation(): { href: string; label: string; createdAt: number } | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object"
      && parsed !== null
      && "href" in parsed
      && "label" in parsed
      && "createdAt" in parsed
      && typeof parsed.href === "string"
      && typeof parsed.label === "string"
      && typeof parsed.createdAt === "number"
    ) {
      return {
        href: parsed.href,
        label: parsed.label,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    // Ignore malformed/stale storage and fall back to no restored feedback.
  }
  return null;
}

function clearStoredNavigation(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}
