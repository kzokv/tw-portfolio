"use client";

import { useEffect, useMemo, useState } from "react";
import type { InstrumentCatalogItemDto, MarketCode } from "@tw-portfolio/shared-types";
import { resolveErrorMessage } from "../../../lib/utils";
import {
  fetchTransactionInstrumentCatalog,
  type InstrumentCatalogMarketFilter,
} from "../services/portfolioService";

export type TransactionInstrumentOption = InstrumentCatalogItemDto & {
  instrumentType: Exclude<InstrumentCatalogItemDto["instrumentType"], null>;
};

const MAX_VISIBLE_INSTRUMENTS = 20;

export function filterInstrumentCatalog(
  catalog: TransactionInstrumentOption[],
  rawQuery: string,
): { total: number; items: TransactionInstrumentOption[] } {
  const normalizedQuery = rawQuery.trim().toLowerCase();
  const matches = normalizedQuery
    ? catalog.filter((instrument) =>
      instrument.ticker.toLowerCase().includes(normalizedQuery) ||
      (instrument.name?.toLowerCase().includes(normalizedQuery) ?? false))
    : catalog;

  return {
    total: matches.length,
    items: matches.slice(0, MAX_VISIBLE_INSTRUMENTS),
  };
}

// KZO-169: hook now accepts a `marketCode` filter so the chip selector can
// drive server-side filtering. Refetch fires whenever the chip changes.
// `null` / `"ALL"` requests the cross-market catalog (chip = All).
export function useInstrumentCatalog(
  marketCode?: MarketCode | "ALL" | null,
): {
  catalog: TransactionInstrumentOption[];
  isLoading: boolean;
  error: string;
} {
  const [catalog, setCatalog] = useState<TransactionInstrumentOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      setIsLoading(true);
      try {
        const filter: InstrumentCatalogMarketFilter = marketCode ?? "ALL";
        const response = await fetchTransactionInstrumentCatalog(filter);
        if (!active) return;
        setCatalog(
          response.instruments.filter(
            (instrument): instrument is TransactionInstrumentOption => instrument.instrumentType !== null,
          ),
        );
        setError("");
      } catch (loadError) {
        if (!active) return;
        setCatalog([]);
        setError(resolveErrorMessage(loadError));
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    loadCatalog();

    return () => {
      active = false;
    };
  }, [marketCode]);

  return useMemo(
    () => ({ catalog, isLoading, error }),
    [catalog, error, isLoading],
  );
}
