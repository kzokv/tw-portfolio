import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../../src/persistence/memory.js";
import {
  buildAdminMarketCalendarHistory,
  confirmAdminMarketCalendarImport,
  previewAdminMarketCalendarImport,
  updateAdminMarketCalendarSource,
} from "../../../src/services/market-data/marketCalendarService.js";

const coverage = {
  scope: "full_year" as const,
  evidence: "Reviewed the official full-year exchange calendar",
};

describe("marketCalendarService", () => {
  it("updates official source provenance without parser or host allowlist fields", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    const { saved } = await updateAdminMarketCalendarSource(persistence, "TW", "official-tw", {
      label: "TW official calendar",
      sourceType: "official_source",
      suggestedSourceUrl: "https://example.com/calendar.csv",
    });

    expect(saved).toMatchObject({
      sourceType: "official_source",
      suggestedSourceUrl: "https://example.com/calendar.csv",
    });
  });

  it("requires full-year coverage evidence and accepts empty exception calendars", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    await expect(previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      retrievedAt: "2026-06-19T00:00:00.000Z",
      coverage: { scope: "full_year", evidence: "" },
      exceptions: [],
    })).rejects.toMatchObject({ code: "market_calendar_coverage_evidence_required" });

    const preview = await previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      retrievedAt: "2026-06-19T00:00:00.000Z",
      coverage,
      exceptions: [],
    });

    expect(preview.source?.id).toBe("official-tw");
    expect(preview.sourceType).toBe("official_source");
    expect(preview.exceptionCount).toBe(0);
    expect(preview.annualCounts.tradingDayCount).toBeGreaterThan(250);
  });

  it("requires a replacement reason when a manual AI-assisted import replaces an official confirmed calendar", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    const initial = await previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      retrievedAt: "2026-06-19T00:00:00.000Z",
      coverage,
      exceptions: [],
    });
    await confirmAdminMarketCalendarImport(persistence, "TW", initial.previewToken);
    const history = await buildAdminMarketCalendarHistory(persistence, "TW", 2026);
    expect(history.items[0]?.importOperationId).toBeTruthy();
    const manualSource = await persistence.saveMarketCalendarSource({
      marketCode: "TW",
      sourceId: "manual-tw",
      label: "Manual import",
      sourceType: "manual_ai_assisted",
      enabled: true,
      isDefault: false,
    });

    await expect(previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      sourceId: manualSource.id,
      sourceType: "manual_ai_assisted",
      label: "Manual import",
      retrievedAt: "2026-06-20T00:00:00.000Z",
      coverage,
      exceptions: [],
      replaceConfirmed: true,
    })).rejects.toMatchObject({ code: "market_calendar_replacement_reason_required" });

    const replacement = await previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      sourceId: manualSource.id,
      sourceType: "manual_ai_assisted",
      label: "Manual import",
      retrievedAt: "2026-06-20T00:00:00.000Z",
      coverage,
      exceptions: [],
      replaceConfirmed: true,
      replacementReason: "operator override",
    });

    await expect(confirmAdminMarketCalendarImport(
      persistence,
      "TW",
      replacement.previewToken,
      true,
      null,
    )).rejects.toMatchObject({ code: "market_calendar_replacement_reason_required" });
  });
});
