"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";

type SettingsTab = "profile" | "general" | "accounts" | "tickers" | "display";

/**
 * Owns the `?drawer=settings&settingsTab=…&accountsPrefillCurrency=…` URL
 * state used to open the Settings drawer from anywhere in the chrome.
 *
 * Extracted from `AppShell.tsx` per Phase 3c spec target (AppShell ≤300 LOC).
 * Per `playwright-navigation-patterns.md`, `router.replace` is paired with
 * `{ scroll: false }` — no `window.history.replaceState` shim needed because
 * no E2E spec asserts on the URL immediately after `setDrawerOpen()`.
 */
export function useSettingsDrawerNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const drawerOpen = searchParams.get("drawer") === "settings";

  const settingsTabParam = searchParams.get("settingsTab");
  const settingsInitialTab: SettingsTab | undefined = useMemo(() => {
    if (
      settingsTabParam === "profile"
      || settingsTabParam === "general"
      || settingsTabParam === "accounts"
      || settingsTabParam === "tickers"
      || settingsTabParam === "display"
    ) {
      return settingsTabParam;
    }
    return undefined;
  }, [settingsTabParam]);

  const accountsPrefillCurrencyParam = searchParams.get("accountsPrefillCurrency");
  const accountsPrefillCurrency: AccountDefaultCurrency | undefined = useMemo(() => {
    if (
      accountsPrefillCurrencyParam === "TWD"
      || accountsPrefillCurrencyParam === "USD"
      || accountsPrefillCurrencyParam === "AUD"
    ) {
      return accountsPrefillCurrencyParam;
    }
    return undefined;
  }, [accountsPrefillCurrencyParam]);

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (open) {
        params.set("drawer", "settings");
      } else {
        params.delete("drawer");
        params.delete("settingsTab");
        params.delete("accountsPrefillCurrency");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { drawerOpen, settingsInitialTab, accountsPrefillCurrency, setDrawerOpen };
}
