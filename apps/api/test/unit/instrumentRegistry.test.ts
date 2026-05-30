import { describe, expect, it } from "vitest";
import { upsertInstrumentDefinitions } from "../../src/services/instrumentRegistry.js";
import type { InstrumentDef } from "../../src/types/store.js";

function instrument(ticker: string, marketCode: string, patch: Partial<InstrumentDef> = {}): InstrumentDef {
  return {
    ticker,
    marketCode,
    type: "STOCK",
    isProvisional: false,
    lastSyncedAt: null,
    typeRaw: null,
    industryCategoryRaw: null,
    finmindDate: null,
    ...patch,
  };
}

describe("upsertInstrumentDefinitions", () => {
  it("keys by ticker + marketCode so cross-market duplicate symbols do not overwrite each other", () => {
    const merged = upsertInstrumentDefinitions(
      [instrument("BHP", "US", { type: "STOCK" })],
      [instrument("BHP", "AU", { type: "ETF" })],
    );

    expect(merged).toEqual([
      expect.objectContaining({ ticker: "BHP", marketCode: "AU", type: "ETF" }),
      expect.objectContaining({ ticker: "BHP", marketCode: "US", type: "STOCK" }),
    ]);
  });

  it("still replaces a provisional row only within the same market", () => {
    const merged = upsertInstrumentDefinitions(
      [instrument("005930", "KR", { isProvisional: true, type: "STOCK" })],
      [instrument("005930", "KR", { isProvisional: false, typeRaw: "KRX" })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      ticker: "005930",
      marketCode: "KR",
      isProvisional: false,
      typeRaw: "KRX",
    });
  });
});
