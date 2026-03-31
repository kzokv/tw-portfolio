import type { RawDailyBar, DividendRecord, FinMindProvider } from "./types.js";

/** Generates deterministic fixture bars for testing. */
function generateMockBars(ticker: string, count: number = 30): RawDailyBar[] {
  const bars: RawDailyBar[] = [];
  const basePrice = 100;
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(2025, 0, 2 + i)); // Start from 2025-01-02
    const dayStr = date.toISOString().slice(0, 10);
    const price = basePrice + i * 0.5;
    bars.push({
      ticker,
      barDate: dayStr,
      open: price,
      high: price + 2,
      low: price - 1,
      close: price + 1,
      volume: 1_000_000 + i * 10_000,
    });
  }
  return bars;
}

/** Generates deterministic fixture dividend events for testing. */
function generateMockDividends(ticker: string): DividendRecord[] {
  return [
    {
      ticker,
      exDividendDate: "2025-06-15",
      paymentDate: "2025-07-15",
      cashDividendPerShare: 2.5,
      stockDividendPerShare: 0,
    },
    {
      ticker,
      exDividendDate: "2025-12-15",
      paymentDate: "2026-01-15",
      cashDividendPerShare: 3.0,
      stockDividendPerShare: 0.5,
    },
  ];
}

export class MockFinMindClient implements FinMindProvider {
  readonly calls: Array<{ method: string; ticker: string }> = [];

  async fetchDailyBars(ticker: string): Promise<RawDailyBar[]> {
    this.calls.push({ method: "fetchDailyBars", ticker });
    return generateMockBars(ticker);
  }

  async fetchDividendEvents(ticker: string): Promise<DividendRecord[]> {
    this.calls.push({ method: "fetchDividendEvents", ticker });
    return generateMockDividends(ticker);
  }
}
