export interface Quote {
  symbol: string;
  unitPrice: number;
  asOf: string;
  source: string;
  dataQuality: "good" | "stale";
}

interface MarketDataProvider {
  name: string;
  getQuotes(symbols: string[]): Promise<Quote[]>;
}

class MockPrimaryProvider implements MarketDataProvider {
  name = "mock-primary";

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.includes("FAIL")) {
      throw new Error("Primary provider simulated failure");
    }
    const now = new Date().toISOString();
    return symbols.map((symbol, idx) => ({
      symbol,
      unitPrice: 100 + idx,
      asOf: now,
      source: this.name,
      dataQuality: "good",
    }));
  }
}

class MockFallbackProvider implements MarketDataProvider {
  name = "mock-fallback";

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const now = new Date().toISOString();
    return symbols.map((symbol, idx) => ({
      symbol,
      unitPrice: 90 + idx,
      asOf: now,
      source: this.name,
      dataQuality: "stale",
    }));
  }
}

export async function getQuotesWithFallback(symbols: string[]): Promise<Quote[]> {
  const primary = new MockPrimaryProvider();
  const fallback = new MockFallbackProvider();

  try {
    return await primary.getQuotes(symbols);
  } catch {
    return fallback.getQuotes(symbols);
  }
}
