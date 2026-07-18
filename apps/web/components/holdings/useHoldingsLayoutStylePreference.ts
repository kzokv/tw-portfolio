"use client";

import { useEffect, useState } from "react";
import type { HoldingsTableLayoutStyle } from "@vakwen/shared-types";
import {
  fetchHoldingsPreferences,
  persistHoldingsTableContexts,
} from "./holdingsPreferenceHelpers";

export function useHoldingsLayoutStylePreference(
  contextKey: string,
  fallback: HoldingsTableLayoutStyle,
) {
  const [layoutStyle, setLayoutStyle] = useState<HoldingsTableLayoutStyle>(fallback);
  const [isHydrated, setIsHydrated] = useState(false);
  const [layoutStyleError, setLayoutStyleError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchHoldingsPreferences()
      .then((response) => {
        if (cancelled) return;
        setLayoutStyle(response.holdingsTableSettings.contexts[contextKey]?.layoutStyle ?? fallback);
        setIsHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [contextKey, fallback]);

  function saveLayoutStyle(nextLayoutStyle: HoldingsTableLayoutStyle): void {
    setLayoutStyle(nextLayoutStyle);
    setLayoutStyleError("");
    void persistHoldingsTableContexts({
      [contextKey]: {
        layoutStyle: nextLayoutStyle,
      },
    }).catch((error) => {
      setLayoutStyleError(error instanceof Error ? error.message : String(error));
    });
  }

  return {
    isHydrated,
    layoutStyle,
    layoutStyleError,
    setLayoutStyle: saveLayoutStyle,
  };
}
