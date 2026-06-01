"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, patchJson } from "../../../lib/api";
import type { HoldingAllocationBasis } from "../holdingGroups";

const STORAGE_KEY = "vakwen-holdings-allocation-basis";

interface UserPreferencesResponse {
  preferences?: {
    holdingAllocationBasis?: unknown;
  };
}

function parseHoldingAllocationBasis(value: unknown): HoldingAllocationBasis | null {
  return value === "market_value" || value === "cost_basis" ? value : null;
}

function readLocalBasis(): HoldingAllocationBasis | null {
  try {
    return parseHoldingAllocationBasis(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeLocalBasis(value: HoldingAllocationBasis): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage unavailable; server preference still receives user changes.
  }
}

export function useHoldingAllocationBasis(defaultValue: HoldingAllocationBasis = "market_value") {
  const [allocationBasis, setAllocationBasis] = useState<HoldingAllocationBasis>(defaultValue);

  useEffect(() => {
    const localBasis = readLocalBasis();
    if (localBasis) {
      setAllocationBasis(localBasis);
    }

    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences")
      .then((response) => {
        if (cancelled) return;
        const saved = parseHoldingAllocationBasis(response?.preferences?.holdingAllocationBasis);
        if (saved) {
          setAllocationBasis(saved);
          writeLocalBasis(saved);
        }
      })
      .catch(() => {
        // Keep local/in-memory fallback when preferences are unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistAllocationBasis = useCallback((next: HoldingAllocationBasis) => {
    setAllocationBasis(next);
    writeLocalBasis(next);
    void patchJson("/user-preferences", { holdingAllocationBasis: next }).catch(() => {
      // The local value remains usable; later GET hydration reconciles from server.
    });
  }, []);

  return { allocationBasis, setAllocationBasis: persistAllocationBasis };
}
