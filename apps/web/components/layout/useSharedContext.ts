"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSharedContextOwnerId } from "../../hooks/useSharedContextOwnerId";
import {
  CONTEXT_FALLBACK_REVOKED_EVENT,
  applyDeepLinkAs,
  clearContextCookie,
  writeContextCookie,
} from "../../lib/context";
import { clearPortfolioContextRouteCaches } from "../../lib/routeDtoCache";
import {
  extractSharingNotificationDetail,
  isRevokedSharingNotification,
} from "../../lib/sharing-notification-matcher";
import { fetchSharingPageData } from "../../features/sharing/service";
import type { InboundShareCardItem } from "../../features/sharing/types";
import type { AppDictionary } from "../../lib/i18n/types";

interface UseSharedContextOptions {
  /** Refresh the dashboard page data on context change. */
  refreshDashboard: () => Promise<void>;
  /** Refresh the profile data on context change. */
  refreshProfile: () => Promise<void>;
  /** Locale-aware dictionary used for the revoked-fallback toast copy. */
  dict: AppDictionary;
}

/**
 * Owns the shared-context (inbound-share / impersonation-as-owner) state +
 * side-effects previously inlined in `AppShell.tsx`:
 *   - inbound-share inventory (`fetchSharingPageData`)
 *   - per-owner deep-link `?as=` apply-once guard
 *   - context-cookie revoke fallback + window-event listener
 *   - the `refreshContextDependentData` orchestrator
 *   - the `handleSharingNotification` callback (passed into `useNotifications`)
 *
 * Returns the live snapshot consumed by `<AppShell>` + the children context
 * (see `AppShellDataContext`).
 *
 * Extracted per Phase 3c spec target (AppShell ≤300 LOC).
 *
 * Preserves §8 items 1, 2, 5: window listener for `CONTEXT_FALLBACK_REVOKED_EVENT`,
 * `?as=ownerId` deep-link, and `router.refresh()` after context changes.
 */
export function useSharedContext({
  refreshDashboard,
  refreshProfile,
  dict,
}: UseSharedContextOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentContextOwnerId = useSharedContextOwnerId();

  const [inboundShares, setInboundShares] = useState<InboundShareCardItem[]>([]);
  const [switcherLoaded, setSwitcherLoaded] = useState(false);
  const [contextMessage, setContextMessage] = useState("");
  const [contextRefreshSignal, setContextRefreshSignal] = useState(0);

  // Preserves §8 item 2 — deep-link guard for ?as=ownerId; ensures we only
  // apply the deep link once even if the effect's deps thrash during
  // router.refresh-driven re-renders.
  const deepLinkAppliedRef = useRef(false);

  const refreshSwitcherData = useCallback(async () => {
    try {
      const sharingData = await fetchSharingPageData({ contextScope: "session" });
      setInboundShares(sharingData.inbound.active);
    } catch {
      setInboundShares([]);
    } finally {
      setSwitcherLoaded(true);
    }
  }, []);

  // Preserves §8 item 5 — router.refresh() after context changes.
  const refreshContextDependentData = useCallback(async () => {
    clearPortfolioContextRouteCaches();
    router.refresh();
    setContextRefreshSignal((n) => n + 1);
    await Promise.allSettled([
      refreshDashboard(),
      refreshProfile(),
      refreshSwitcherData(),
    ]);
  }, [refreshDashboard, refreshProfile, refreshSwitcherData, router]);

  useEffect(() => {
    void refreshSwitcherData();
  }, [refreshSwitcherData]);

  useEffect(() => {
    if (!switcherLoaded || !currentContextOwnerId) return;
    const stillActive = inboundShares.some((item) => item.ownerUserId === currentContextOwnerId);
    if (stillActive) return;
    clearContextCookie();
    setContextMessage(dict.switcher.revokedFallback);
    void refreshContextDependentData();
  }, [
    currentContextOwnerId,
    dict.switcher.revokedFallback,
    inboundShares,
    refreshContextDependentData,
    switcherLoaded,
  ]);

  // Preserves §8 item 2 — ?as=ownerId deep-link applied once.
  useEffect(() => {
    if (!switcherLoaded) return;
    if (deepLinkAppliedRef.current) return;
    const asOwnerId = searchParams.get("as");
    if (!asOwnerId) return;

    const ownerIds = inboundShares
      .map((item) => item.ownerUserId)
      .filter((value): value is string => Boolean(value));
    const appliedOwnerId = applyDeepLinkAs(searchParams, ownerIds);

    deepLinkAppliedRef.current = true;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("as");
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    window.history.replaceState({}, "", nextUrl);

    if (appliedOwnerId) {
      setContextMessage("");
      void refreshContextDependentData();
    }
  }, [
    inboundShares,
    pathname,
    refreshContextDependentData,
    searchParams,
    switcherLoaded,
  ]);

  // Preserves §8 item 1 — CONTEXT_FALLBACK_REVOKED_EVENT window listener.
  useEffect(() => {
    function handleFallbackRevoked(): void {
      setContextMessage(dict.switcher.revokedFallback);
      void refreshContextDependentData();
    }
    window.addEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, handleFallbackRevoked);
    return () => {
      window.removeEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, handleFallbackRevoked);
    };
  }, [dict.switcher.revokedFallback, refreshContextDependentData]);

  const handleContextSelect = useCallback(
    (ownerUserId: string | null) => {
      setContextMessage("");
      if (ownerUserId) {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        writeContextCookie(ownerUserId);
      } else {
        clearContextCookie();
      }
      void refreshContextDependentData();
    },
    [refreshContextDependentData],
  );

  const handleSharingNotification = useCallback(
    (notification: { title: string; detail: unknown }) => {
      void refreshSwitcherData();
      const detail = extractSharingNotificationDetail(notification.detail);
      const ownerUserId = detail?.ownerUserId ?? null;
      const ownerLabel =
        detail?.ownerDisplayName || detail?.ownerEmail || dict.switcher.self;
      if (
        isRevokedSharingNotification(notification)
        && ownerUserId
        && ownerUserId === currentContextOwnerId
      ) {
        clearContextCookie();
        setContextMessage(dict.switcher.revokedFallbackOwner.replace("{owner}", ownerLabel));
        void refreshContextDependentData();
      }
    },
    [currentContextOwnerId, dict.switcher, refreshContextDependentData, refreshSwitcherData],
  );

  const currentSharedOwner = useMemo(
    () =>
      currentContextOwnerId
        ? inboundShares.find((item) => item.ownerUserId === currentContextOwnerId) ?? null
        : null,
    [currentContextOwnerId, inboundShares],
  );
  const isSharedContext = currentSharedOwner !== null;
  const currentSharedOwnerLabel =
    currentSharedOwner?.ownerDisplayName
    || currentSharedOwner?.ownerEmail
    || dict.switcher.self;

  return {
    inboundShares,
    switcherLoaded,
    currentContextOwnerId,
    currentSharedOwner,
    currentSharedOwnerLabel,
    isSharedContext,
    contextMessage,
    contextRefreshSignal,
    bumpContextRefreshSignal: useCallback(
      () => setContextRefreshSignal((n) => n + 1),
      [],
    ),
    refreshContextDependentData,
    handleContextSelect,
    handleSharingNotification,
  };
}

// Re-export for ergonomic typing at the call site.
export type SharedContextState = ReturnType<typeof useSharedContext>;
