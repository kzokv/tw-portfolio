import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../../src/persistence/memory.js";

describe("market calendar activity persistence", () => {
  it("filters market activity rows by category, result, and search text", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    await persistence.createMarketCalendarActivityEvent({
      marketCode: "TW",
      category: "calendar",
      result: "skipped",
      source: "official_calendar",
      eventType: "calendar_unknown_intraday_skip",
      title: "Calendar unknown",
      message: "TW intraday enqueue skipped because the official calendar is unknown.",
      ticker: "2330",
      calendarYear: 2026,
      occurredAt: "2026-06-17T00:00:00.000Z",
      detail: { localDate: "2026-06-19", sourceHost: "www.twse.com.tw" },
    });
    await persistence.createMarketCalendarActivityEvent({
      marketCode: "TW",
      category: "intraday_price",
      result: "success",
      source: "yahoo_chart",
      eventType: "intraday_refresh_completed",
      title: "Intraday refresh completed",
      message: "2330 intraday refresh completed.",
      ticker: "2330",
      providerSymbol: "2330.TW",
      occurredAt: "2026-06-19T00:00:00.000Z",
      detail: {},
    });

    const filtered = await persistence.listMarketCalendarActivity({
      marketCode: "TW",
      page: 1,
      limit: 25,
      categories: ["calendar"],
      results: ["skipped"],
      search: "unknown",
    });

    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({
      eventType: "calendar_unknown_intraday_skip",
      category: "calendar",
      result: "skipped",
      ticker: "2330",
      calendarYear: 2026,
    });

    const yearFiltered = await persistence.listMarketCalendarActivity({
      marketCode: "TW",
      page: 1,
      limit: 25,
      search: "2026",
    });
    expect(yearFiltered.total).toBe(1);

    const hostFiltered = await persistence.listMarketCalendarActivity({
      marketCode: "TW",
      page: 1,
      limit: 25,
      search: "twse.com.tw",
    });
    expect(hostFiltered.total).toBe(1);

    const recentOnly = await persistence.listMarketCalendarActivity({
      marketCode: "TW",
      page: 1,
      limit: 25,
      occurredAfter: "2026-06-18T00:00:00.000Z",
    });
    expect(recentOnly.total).toBe(1);
    expect(recentOnly.items[0]?.eventType).toBe("intraday_refresh_completed");
  });

  it("mirrors provider operation logs into provider-operation activity", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    const operation = await persistence.createProviderOperation({
      providerId: "finmind-tw",
      marketCode: "TW",
      operationType: "sync_catalog",
      phase: "running",
    });
    await persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "running",
      level: "warning",
      message: "sync_catalog delayed by provider throttle",
    });

    const activity = await persistence.listMarketCalendarActivity({
      marketCode: "TW",
      page: 1,
      limit: 25,
      categories: ["provider_operation"],
      search: operation.id,
    });

    expect(activity.total).toBe(1);
    expect(activity.items[0]).toMatchObject({
      category: "provider_operation",
      result: "warning",
      source: "finmind",
      operationId: operation.id,
      eventType: "provider_operation_running",
    });
  });
});
