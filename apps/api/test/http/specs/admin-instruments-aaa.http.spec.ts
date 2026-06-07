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
    const body = {
      scope: "manual_targets",
      providerId: "finmind-tw",
      manualTargets: [{ ticker: "TWMDF1", marketCode: "TW" }],
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
    assertEqual(previewBody.scope, "manual_targets", "backfill preview scope");
    assertEqual(previewBody.matchCount, 1, "backfill preview matchCount");
    assertEqual(previewConfirmation.level, "checkbox", "backfill preview confirmation.level");

    const execute = await request.post("/admin/market-data/TW/backfill/execute", {
      headers: { cookie: admin.cookieHeader },
      data: { ...body, acknowledged: true },
    });

    await assertStatus(execute, 200);
    const executeBody = assertRecord(await execute.json(), "backfill execute body");
    assertEqual(executeBody.marketCode, "TW", "backfill execute marketCode");
    assertEqual(executeBody.providerId, "finmind-tw", "backfill execute providerId");
    assertEqual(executeBody.scope, "manual_targets", "backfill execute scope");
    assertEqual(executeBody.matchCount, 1, "backfill execute matchCount");
    if (executeBody.status !== "queued" && executeBody.status !== "completed") {
      throw new Error(`backfill execute status must be queued or completed, received ${String(executeBody.status)}`);
    }
    assertString(executeBody.operationId, "backfill execute operationId");
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

    const execute = await request.post("/admin/market-data/TW/purge/execute", {
      headers: { cookie: admin.cookieHeader },
      data: { ...body, typedConfirmation: "PURGE TW" },
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
});
