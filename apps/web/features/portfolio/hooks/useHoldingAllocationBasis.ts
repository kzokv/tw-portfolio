"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, patchJson } from "../../../lib/api";
import type { HoldingAllocationBasis } from "../holdingGroups";

interface UserPreferencesResponse {
  preferences?: {
    holdingAllocationBasis?: unknown;
  };
}

function parseHoldingAllocationBasis(value: unknown): HoldingAllocationBasis | null {
  return value === "market_value" || value === "cost_basis" ? value : null;
}

export function useHoldingAllocationBasis(defaultValue: HoldingAllocationBasis = "market_value") {
  const [allocationBasis, setAllocationBasis] = useState<HoldingAllocationBasis>(defaultValue);

  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" })
      .then((response) => {
        if (cancelled) return;
        const saved = parseHoldingAllocationBasis(response?.preferences?.holdingAllocationBasis);
        if (saved) {
          setAllocationBasis(saved);
        }
      })
      .catch(() => {
        // Keep the in-memory default when preferences are unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistAllocationBasis = useCallback((next: HoldingAllocationBasis) => {
    setAllocationBasis(next);
    void patchJson("/user-preferences", { holdingAllocationBasis: next }, { contextScope: "session" }).catch(() => {
      // The in-memory value remains usable; later GET hydration reconciles from server.
    });
  }, []);

  return { allocationBasis, setAllocationBasis: persistAllocationBasis };
}
