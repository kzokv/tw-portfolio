import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../../src/persistence/memory.js";
import {
  buildAdminMarketCalendarHistory,
  confirmAdminMarketCalendarImport,
  previewAdminMarketCalendarImport,
  updateAdminMarketCalendarSource,
} from "../../../src/services/market-data/marketCalendarService.js";

function fullYearRows(year: number) {
  const rows: Array<{ date: string; isOpen: boolean; evidence: string; notes?: string | null }> = [];
  const current = new Date(`${year}-01-01T00:00:00.000Z`);
  while (current.getUTCFullYear() === year) {
    const date = current.toISOString().slice(0, 10);
    const day = current.getUTCDay();
    rows.push({
      date,
      isOpen: day >= 1 && day <= 5,
      evidence: `official:${date}`,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return rows;
}

describe("marketCalendarService", () => {
  it("rejects official source updates when the host is outside the allowlist", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    await expect(updateAdminMarketCalendarSource(persistence, "TW", "official-tw", {
      label: "TW official calendar",
      sourceType: "official_parser",
      parserId: "tw-official",
      url: "https://example.com/calendar.csv",
    })).rejects.toMatchObject({ code: "market_calendar_host_not_allowlisted" });
  });

  it("requires full-year normalized payload coverage and resolves the default source when omitted", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    await expect(previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      retrievedAt: "2026-06-19T00:00:00.000Z",
      rows: fullYearRows(2026).slice(1),
    })).rejects.toMatchObject({ code: "market_calendar_full_year_required" });

    const preview = await previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      retrievedAt: "2026-06-19T00:00:00.000Z",
      rows: fullYearRows(2026),
    });

    expect(preview.source?.id).toBe("official-tw");
    expect(preview.sourceType).toBe("official_parser");
    expect(preview.rowCount).toBe(365);
  });

  it("requires a replacement reason when a manual AI-assisted import replaces an official confirmed calendar", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    const initial = await previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      retrievedAt: "2026-06-19T00:00:00.000Z",
      rows: fullYearRows(2026),
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
      rows: fullYearRows(2026),
      replaceConfirmed: true,
    })).rejects.toMatchObject({ code: "market_calendar_replacement_reason_required" });

    const replacement = await previewAdminMarketCalendarImport(persistence, "TW", {
      calendarYear: 2026,
      sourceId: manualSource.id,
      sourceType: "manual_ai_assisted",
      label: "Manual import",
      retrievedAt: "2026-06-20T00:00:00.000Z",
      rows: fullYearRows(2026),
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
