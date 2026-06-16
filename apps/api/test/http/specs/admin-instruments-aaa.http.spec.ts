/**
 * Provider fixers - HTTP/AAA coverage for market-data instrument admin.
 *
 * The standalone `/admin/instruments` backend route is retired. Instrument
 * support state now flows through `/admin/market-data/:marketCode`.
 */

import type { APIResponse } from "@playwright/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

async function assertStatus(response: APIResponse, expected: number): Promise<void> {
  const actual = response.status();
  if (actual !== expected) {
    throw new Error(`Expected HTTP ${expected}, received ${actual}: ${await response.text()}`);
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

test.describe("admin market-data instruments", () => {
  test("[support-state]: admin can mark an AU instrument retired via /admin/market-data", async ({
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-support-state-sub",
      email: "market-data-admin-support-state@example.com",
      name: "Market Data Admin Support State",
      role: "admin",
    });

    const response = await request.post("/admin/market-data/AU/instruments/support-state", {
      headers: { cookie: admin.cookieHeader },
      data: {
        ticker: "AUDEL41",
        marketCode: "AU",
        supportState: "retired_by_admin",
      },
    });

    await assertStatus(response, 200);
    const body = assertRecord(await response.json(), "support-state body");
    const instrument = assertRecord(body.instrument, "support-state body.instrument");
    assertEqual(instrument.ticker, "AUDEL41", "instrument.ticker");
    assertEqual(instrument.marketCode, "AU", "instrument.marketCode");
    assertEqual(instrument.supportState, "retired_by_admin", "instrument.supportState");
    assertEqual(instrument.delistingDetectionExcluded, false, "instrument.delistingDetectionExcluded");
  });

  test("[auth]: member cannot mutate support state", async ({ request }) => {
    const member = await createOauthSession(request, {
      sub: "market-data-member-support-state-sub",
      email: "market-data-member-support-state@example.com",
      name: "Market Data Member Support State",
      role: "member",
    });

    const response = await request.post("/admin/market-data/AU/instruments/support-state", {
      headers: { cookie: member.cookieHeader },
      data: {
        ticker: "AUDEL42",
        marketCode: "AU",
        supportState: "unsupported_by_provider",
      },
    });

    await assertStatus(response, 403);
    const body = assertRecord(await response.json(), "member error body");
    assertEqual(body.error, "admin_role_required", "member error body.error");
  });

  test("[delisting-override]: admin mutates AU delisting override separately from support state", async ({
    instrumentsApi,
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-delisting-override-sub",
      email: "market-data-admin-delisting-override@example.com",
      name: "Market Data Admin Delisting Override",
      role: "admin",
    });
    const seed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "AUOVR1",
        marketCode: "AU",
        name: "AU override fixture 1",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
      {
        ticker: "AUOVR2",
        marketCode: "AU",
        name: "AU override fixture 2",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
        delistedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    await assertStatus(seed, 200);

    const exclude = await request.post("/admin/market-data/AU/instruments/delisting-override", {
      headers: { cookie: admin.cookieHeader },
      data: {
        ticker: "AUOVR1",
        marketCode: "AU",
        action: "exclude_from_delisting_detection",
      },
    });

    await assertStatus(exclude, 200);
    const excludeBody = assertRecord(await exclude.json(), "exclude body");
    const excluded = assertRecord(excludeBody.instrument, "exclude body.instrument");
    assertEqual(excluded.ticker, "AUOVR1", "excluded.ticker");
    assertEqual(excluded.status, "excluded", "excluded.status");
    assertEqual(excluded.supportState, "supported", "excluded.supportState");
    assertEqual(excluded.delistingDetectionExcluded, true, "excluded.delistingDetectionExcluded");

    const include = await request.post("/admin/market-data/AU/instruments/delisting-override", {
      headers: { cookie: admin.cookieHeader },
      data: {
        ticker: "AUOVR1",
        marketCode: "AU",
        action: "include_in_delisting_detection",
      },
    });

    await assertStatus(include, 200);
    const includeBody = assertRecord(await include.json(), "include body");
    const included = assertRecord(includeBody.instrument, "include body.instrument");
    assertEqual(included.status, "listed", "included.status");
    assertEqual(included.delistingDetectionExcluded, false, "included.delistingDetectionExcluded");

    const clear = await request.post("/admin/market-data/AU/instruments/delisting-override", {
      headers: { cookie: admin.cookieHeader },
      data: {
        ticker: "AUOVR2",
        marketCode: "AU",
        action: "clear_delisted_state",
      },
    });

    await assertStatus(clear, 200);
    const clearBody = assertRecord(await clear.json(), "clear body");
    const cleared = assertRecord(clearBody.instrument, "clear body.instrument");
    assertEqual(cleared.ticker, "AUOVR2", "cleared.ticker");
    assertEqual(cleared.status, "listed", "cleared.status");
    assertEqual(cleared.delistedAt, null, "cleared.delistedAt");

    const unsupported = await request.post("/admin/market-data/TW/instruments/delisting-override", {
      headers: { cookie: admin.cookieHeader },
      data: {
        ticker: "2330",
        marketCode: "TW",
        action: "exclude_from_delisting_detection",
      },
    });
    await assertStatus(unsupported, 400);
  });

  test("[retired-route]: standalone /admin/instruments is no longer a backend route", async ({
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-retired-route-sub",
      email: "market-data-admin-retired-route@example.com",
      name: "Market Data Admin Retired Route",
      role: "admin",
    });

    const response = await request.get("/admin/instruments?marketCode=AU&page=1&limit=1", {
      headers: { cookie: admin.cookieHeader },
    });

    await assertStatus(response, 404);
  });

  test("[backfill-execute]: admin previews and executes a provider-owned market backfill", async ({
    instrumentsApi,
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-backfill-execute-sub",
      email: "market-data-admin-backfill-execute@example.com",
      name: "Market Data Admin Backfill Execute",
      role: "admin",
    });
    const seed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "TWMDF1",
        marketCode: "TW",
        name: "TW market-data fixture 1",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
    ]);
    await assertStatus(seed, 200);
    const removedManualPreview = await request.post("/admin/market-data/TW/backfill/preview", {
      headers: { cookie: admin.cookieHeader },
      data: {
        scope: "manual_targets",
        providerId: "finmind-tw",
        manualTargets: [{ ticker: "TWMDF1", marketCode: "TW" }],
      },
    });
    await assertStatus(removedManualPreview, 400);

    const body = {
      scope: "selected_catalog_rows",
      providerId: "finmind-tw",
      selectedCatalogRows: [{ ticker: "TWMDF1", marketCode: "TW" }],
    };

    const preview = await request.post("/admin/market-data/TW/backfill/preview", {
      headers: { cookie: admin.cookieHeader },
      data: body,
    });

    await assertStatus(preview, 200);
    const previewBody = assertRecord(await preview.json(), "backfill preview body");
    const previewConfirmation = assertRecord(previewBody.confirmation, "backfill preview confirmation");
    assertEqual(previewBody.marketCode, "TW", "backfill preview marketCode");
    assertEqual(previewBody.providerId, "finmind-tw", "backfill preview providerId");
    assertEqual(previewBody.scope, "selected_catalog_rows", "backfill preview scope");
    assertEqual(previewBody.matchCount, 1, "backfill preview matchCount");
    assertEqual(previewConfirmation.level, "checkbox", "backfill preview confirmation.level");
    assertString(previewBody.operationId, "backfill preview operationId");
    assertString(previewBody.previewToken, "backfill preview previewToken");
    assertString(previewBody.tokenExpiresAt, "backfill preview tokenExpiresAt");
    const previewTargets = assertArray(previewBody.targets, "backfill preview targets");
    assertEqual(previewTargets.length, 1, "backfill preview targets.length");
    assertEqual(assertRecord(previewTargets[0], "backfill preview target").ticker, "TWMDF1", "backfill preview target.ticker");

    const execute = await request.post("/admin/market-data/TW/backfill/execute", {
      headers: { cookie: admin.cookieHeader },
      data: {
        operationId: previewBody.operationId,
        previewToken: previewBody.previewToken,
        acknowledged: true,
      },
    });

    await assertStatus(execute, 200);
    const executeBody = assertRecord(await execute.json(), "backfill execute body");
    assertEqual(executeBody.marketCode, "TW", "backfill execute marketCode");
    assertEqual(executeBody.providerId, "finmind-tw", "backfill execute providerId");
    assertEqual(executeBody.scope, "selected_catalog_rows", "backfill execute scope");
    assertEqual(executeBody.matchCount, 1, "backfill execute matchCount");
    if (executeBody.status !== "queued" && executeBody.status !== "completed") {
      throw new Error(`backfill execute status must be queued or completed, received ${String(executeBody.status)}`);
    }
    assertString(executeBody.operationId, "backfill execute operationId");
  });

  test("[backfill-preview]: rejects end date before the effective provider floor", async ({
    instrumentsApi,
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-backfill-range-sub",
      email: "market-data-admin-backfill-range@example.com",
      name: "Market Data Admin Backfill Range",
      role: "admin",
    });
    const seed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "USRNG1",
        marketCode: "US",
        name: "US range fixture",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
    ]);
    await assertStatus(seed, 200);

    const preview = await request.post("/admin/market-data/US/backfill/preview", {
      headers: { cookie: admin.cookieHeader },
      data: {
        scope: "selected_catalog_rows",
        providerId: "finmind-us",
        selectedCatalogRows: [{ ticker: "USRNG1", marketCode: "US" }],
        startDate: "2018-01-01",
        endDate: "2018-01-15",
      },
    });

    await assertStatus(preview, 400);
    const body = assertRecord(await preview.json(), "backfill range preview body");
    assertEqual(body.error, "market_backfill_range_before_provider_history", "backfill range error");
  });

  test("[purge-execute]: admin previews and executes a targeted market-data purge", async ({
    instrumentsApi,
    marketDataApi,
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-purge-execute-sub",
      email: "market-data-admin-purge-execute@example.com",
      name: "Market Data Admin Purge Execute",
      role: "admin",
    });
    const seed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "TWMDF2",
        marketCode: "TW",
        name: "TW market-data fixture 2",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
    ]);
    await assertStatus(seed, 200);
    const bars = await marketDataApi.actions.seedDailyBars([
      {
        ticker: "TWMDF2",
        marketCode: "TW",
        barDate: "2026-01-02",
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 1000,
        source: "finmind-tw",
      },
    ]);
    await assertStatus(bars, 200);
    const body = {
      providerId: "finmind-tw",
      categories: ["price_bars"],
      targets: [{ ticker: "TWMDF2", marketCode: "TW" }],
      fullHistory: true,
      enqueueBackfillAfterPurge: false,
    };

    const preview = await request.post("/admin/market-data/TW/purge/preview", {
      headers: { cookie: admin.cookieHeader },
      data: body,
    });

    await assertStatus(preview, 200);
    const previewBody = assertRecord(await preview.json(), "purge preview body");
    const previewConfirmation = assertRecord(previewBody.confirmation, "purge preview confirmation");
    assertEqual(previewBody.marketCode, "TW", "purge preview marketCode");
    assertEqual(previewBody.providerId, "finmind-tw", "purge preview providerId");
    assertEqual(Array.isArray(previewBody.categories) ? previewBody.categories.join(",") : null, "price_bars", "purge preview categories");
    assertEqual(previewBody.affectedInstrumentCount, 1, "purge preview affectedInstrumentCount");
    assertEqual(previewBody.estimatedRows, 1, "purge preview estimatedRows");
    assertEqual(previewConfirmation.level, "typed", "purge preview confirmation.level");
    assertEqual(previewConfirmation.text, "PURGE TW", "purge preview confirmation.text");
    assertString(previewBody.operationId, "purge preview operationId");
    assertString(previewBody.previewToken, "purge preview previewToken");
    assertString(previewBody.tokenExpiresAt, "purge preview tokenExpiresAt");

    const execute = await request.post("/admin/market-data/TW/purge/execute", {
      headers: { cookie: admin.cookieHeader },
      data: {
        operationId: previewBody.operationId,
        previewToken: previewBody.previewToken,
        typedConfirmation: "PURGE TW",
      },
    });

    await assertStatus(execute, 200);
    const executeBody = assertRecord(await execute.json(), "purge execute body");
    assertEqual(executeBody.marketCode, "TW", "purge execute marketCode");
    assertEqual(executeBody.providerId, "finmind-tw", "purge execute providerId");
    assertEqual(executeBody.status, "completed", "purge execute status");
    assertEqual(executeBody.affectedInstrumentCount, 1, "purge execute affectedInstrumentCount");
    assertEqual(executeBody.deletedRows, 1, "purge execute deletedRows");
    assertString(executeBody.operationId, "purge execute operationId");
    assertEqual(executeBody.linkedBackfillOperationId, null, "purge execute linkedBackfillOperationId");
  });

  test("[backfill-preview]: newer preview supersedes older preview before execute", async ({
    instrumentsApi,
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-backfill-supersede-sub",
      email: "market-data-admin-backfill-supersede@example.com",
      name: "Market Data Admin Backfill Supersede",
      role: "admin",
    });
    const seed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "TWMDFS1",
        marketCode: "TW",
        name: "TW market-data supersede fixture",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
    ]);
    await assertStatus(seed, 200);
    const previewBody = {
      scope: "selected_catalog_rows",
      providerId: "finmind-tw",
      selectedCatalogRows: [{ ticker: "TWMDFS1", marketCode: "TW" }],
    };

    const firstPreview = await request.post("/admin/market-data/TW/backfill/preview", {
      headers: { cookie: admin.cookieHeader },
      data: previewBody,
    });
    await assertStatus(firstPreview, 200);
    const first = assertRecord(await firstPreview.json(), "first backfill preview body");

    const secondPreview = await request.post("/admin/market-data/TW/backfill/preview", {
      headers: { cookie: admin.cookieHeader },
      data: previewBody,
    });
    await assertStatus(secondPreview, 200);
    const second = assertRecord(await secondPreview.json(), "second backfill preview body");

    const staleExecute = await request.post("/admin/market-data/TW/backfill/execute", {
      headers: { cookie: admin.cookieHeader },
      data: {
        operationId: first.operationId,
        previewToken: first.previewToken,
        acknowledged: true,
      },
    });
    await assertStatus(staleExecute, 400);

    const freshExecute = await request.post("/admin/market-data/TW/backfill/execute", {
      headers: { cookie: admin.cookieHeader },
      data: {
        operationId: second.operationId,
        previewToken: second.previewToken,
        acknowledged: true,
      },
    });
    await assertStatus(freshExecute, 200);
  });

  test("[purge-execute]: execution uses the frozen preview snapshot", async ({
    instrumentsApi,
    marketDataApi,
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-purge-snapshot-sub",
      email: "market-data-admin-purge-snapshot@example.com",
      name: "Market Data Admin Purge Snapshot",
      role: "admin",
    });
    const firstSeed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "TWPURGESNAP1",
        marketCode: "TW",
        name: "TW purge snapshot fixture 1",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
    ]);
    await assertStatus(firstSeed, 200);
    await assertStatus(await marketDataApi.actions.seedDailyBars([
      {
        ticker: "TWPURGESNAP1",
        marketCode: "TW",
        barDate: "2026-01-02",
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 1000,
        source: "finmind-tw",
      },
    ]), 200);

    const preview = await request.post("/admin/market-data/TW/purge/preview", {
      headers: { cookie: admin.cookieHeader },
      data: {
        providerId: "finmind-tw",
        categories: ["price_bars"],
        fullHistory: true,
        filters: { search: "TWPURGESNAP" },
      },
    });
    await assertStatus(preview, 200);
    const previewBody = assertRecord(await preview.json(), "purge snapshot preview body");
    assertEqual(previewBody.affectedInstrumentCount, 1, "purge snapshot preview affectedInstrumentCount");

    const secondSeed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "TWPURGESNAP2",
        marketCode: "TW",
        name: "TW purge snapshot fixture 2",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
    ]);
    await assertStatus(secondSeed, 200);
    await assertStatus(await marketDataApi.actions.seedDailyBars([
      {
        ticker: "TWPURGESNAP2",
        marketCode: "TW",
        barDate: "2026-01-02",
        open: 20,
        high: 22,
        low: 19,
        close: 21,
        volume: 2000,
        source: "finmind-tw",
      },
    ]), 200);

    const execute = await request.post("/admin/market-data/TW/purge/execute", {
      headers: { cookie: admin.cookieHeader },
      data: {
        operationId: previewBody.operationId,
        previewToken: previewBody.previewToken,
        typedConfirmation: "PURGE TW",
      },
    });
    await assertStatus(execute, 200);
    const executeBody = assertRecord(await execute.json(), "purge snapshot execute body");
    assertEqual(executeBody.deletedRows, 1, "purge snapshot execute deletedRows");

    const secondPrice = await marketDataApi.actions.getPrice("TWPURGESNAP2", "2026-01-02", "TW");
    await assertStatus(secondPrice, 200);
  });

  test("[purge-preview]: admin-state reset includes retired instruments in matching scope", async ({
    instrumentsApi,
    request,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "market-data-admin-purge-retired-sub",
      email: "market-data-admin-purge-retired@example.com",
      name: "Market Data Admin Purge Retired",
      role: "admin",
    });
    const seed = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "AUPURGERET1",
        marketCode: "AU",
        name: "AU purge retired fixture",
        instrumentType: "STOCK",
        barsBackfillStatus: "pending",
      },
    ]);
    await assertStatus(seed, 200);
    const support = await request.post("/admin/market-data/AU/instruments/support-state", {
      headers: { cookie: admin.cookieHeader },
      data: {
        ticker: "AUPURGERET1",
        marketCode: "AU",
        supportState: "retired_by_admin",
      },
    });
    await assertStatus(support, 200);

    const preview = await request.post("/admin/market-data/AU/purge/preview", {
      headers: { cookie: admin.cookieHeader },
      data: {
        providerId: "yahoo-finance-au",
        categories: ["admin_state_reset"],
        fullHistory: true,
        filters: { search: "AUPURGERET1" },
      },
    });

    await assertStatus(preview, 200);
    const previewBody = assertRecord(await preview.json(), "purge retired preview body");
    assertEqual(previewBody.marketCode, "AU", "purge retired preview marketCode");
    assertEqual(previewBody.providerId, "yahoo-finance-au", "purge retired preview providerId");
    assertEqual(previewBody.affectedInstrumentCount, 1, "purge retired preview affectedInstrumentCount");
  });
});
