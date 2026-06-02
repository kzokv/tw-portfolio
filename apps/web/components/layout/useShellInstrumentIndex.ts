"use client";

import { useEffect, useState } from "react";
import type { InstrumentOptionDto } from "@vakwen/shared-types";
import {
  fetchPortfolioInstrumentIndex,
  fetchTransactionInstrumentCatalog,
} from "../../features/portfolio/services/portfolioService";

export function useShellInstrumentIndex(refreshSignal = 0): InstrumentOptionDto[] {
  const [instruments, setInstruments] = useState<InstrumentOptionDto[]>([]);

  useEffect(() => {
    let cancelled = false;

    void fetchPortfolioInstrumentIndex()
      .then(async (response) => {
        if (cancelled) return;
        if (response.instruments.length > 0) {
          setInstruments(response.instruments);
          return;
        }

        const catalog = await fetchTransactionInstrumentCatalog("ALL");
        if (cancelled) return;
        setInstruments(
          catalog.instruments
            .filter((instrument): instrument is typeof instrument & { instrumentType: NonNullable<typeof instrument.instrumentType> } =>
              instrument.instrumentType !== null)
            .map((instrument) => ({
              ticker: instrument.ticker,
              instrumentType: instrument.instrumentType,
              marketCode: instrument.marketCode,
              isProvisional: false,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setInstruments([]);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  return instruments;
}
