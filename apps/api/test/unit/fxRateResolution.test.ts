import { describe, expect, it } from "vitest";

const { MemoryPersistence } = await import("../../src/persistence/memory.js");

describe("MemoryPersistence.getFxRate derived resolution", () => {
  it("uses inverse and TWD-pivot rates when a direct pair is absent", async () => {
    const persistence = new MemoryPersistence();
    await persistence.upsertFxRates([
      { date: "2026-06-10", baseCurrency: "USD", quoteCurrency: "TWD", rate: 32.5, source: "unit" },
      { date: "2026-06-10", baseCurrency: "KRW", quoteCurrency: "TWD", rate: 0.025, source: "unit" },
    ]);

    await expect(persistence.getFxRate("TWD", "KRW", "2026-06-11")).resolves.toBeCloseTo(40, 6);
    await expect(persistence.getFxRate("USD", "KRW", "2026-06-11")).resolves.toBeCloseTo(1300, 6);
  });
});
