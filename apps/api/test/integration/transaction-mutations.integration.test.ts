import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { transactionPayload, feeProfilePayload, type TransactionType } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

// ─── Helpers ───────────────────────────────────────────────────────────

let idempotencyCounter = 0;

/** Create a trade via POST /portfolio/transactions with auto-generated idempotency key. */
async function createTrade(
  appInstance: Awaited<ReturnType<typeof buildApp>>,
  overrides: Parameters<typeof transactionPayload>[0] = {},
) {
  idempotencyCounter += 1;
  const res = await appInstance.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `k-mut-${idempotencyCounter}` },
    payload: transactionPayload(overrides),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    id: string;
    accountId: string;
    ticker: string;
    type: TransactionType;
    quantity: number;
    unitPrice: number;
    commissionAmount: number;
    taxAmount: number;
    tradeDate: string;
    bookingSequence?: number;
  };
}

/** Load store for the default test user. */
async function getStore(appInstance: Awaited<ReturnType<typeof buildApp>>) {
  return appInstance.persistence.loadStore("user-1");
}

type DestructivePreviewBody = {
  preview: {
    previewId: string;
    previewVersion: number;
    fingerprint: string;
  };
  affectedCounts: {
    cashLedgerEntries: number;
    lotAllocations: number;
  };
};

async function previewTradeDelete(
  appInstance: Awaited<ReturnType<typeof buildApp>>,
  tradeEventId: string,
  headers?: Record<string, string>,
) {
  return appInstance.inject({
    method: "POST",
    url: `/portfolio/transactions/${tradeEventId}/dividend-delete-preview`,
    headers,
    payload: { reason: "Integration test history rewrite" },
  });
}

async function confirmTradeDelete(
  appInstance: Awaited<ReturnType<typeof buildApp>>,
  tradeEventId: string,
  preview: DestructivePreviewBody,
  headers?: Record<string, string>,
) {
  return appInstance.inject({
    method: "POST",
    url: `/portfolio/transactions/${tradeEventId}/dividend-delete-confirm`,
    headers,
    payload: {
      previewId: preview.preview.previewId,
      previewVersion: preview.preview.previewVersion,
      fingerprint: preview.preview.fingerprint,
    },
  });
}

async function deleteTradeWithPreview(
  appInstance: Awaited<ReturnType<typeof buildApp>>,
  tradeEventId: string,
) {
  const previewResponse = await previewTradeDelete(appInstance, tradeEventId);
  expect(previewResponse.statusCode).toBe(200);
  const preview = previewResponse.json<DestructivePreviewBody>();
  const confirmResponse = await confirmTradeDelete(appInstance, tradeEventId, preview);
  expect(confirmResponse.statusCode).toBe(200);
  return { preview, confirmResponse };
}

/**
 * Subscribe to EventBus for user-1 and collect events.
 * Returns the events array and a waitFor helper that resolves when an event
 * of the given type appears (or rejects on timeout).
 */
function collectBusEvents(appInstance: Awaited<ReturnType<typeof buildApp>>, userId = "user-1") {
  const events: Array<{ type: string; data: unknown }> = [];
  const unsub = appInstance.eventBus.subscribe(userId, (event) => events.push(event));
  return {
    events,
    unsub,
    waitFor: (type: string, timeoutMs = 2000) =>
      new Promise<{ type: string; data: unknown }>((resolve, reject) => {
        // Check if already received
        const existing = events.find((e) => e.type === type);
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error(`Timeout waiting for event "${type}" after ${timeoutMs}ms`)),
          timeoutMs,
        );
        const checkUnsub = appInstance.eventBus.subscribe(userId, (event) => {
          if (event.type === type) {
            clearTimeout(timer);
            checkUnsub();
            resolve(event);
          }
        });
      }),
  };
}

/** Wait for async setImmediate-based recompute to complete (including retry). */
async function waitForRecompute(ms = 200) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Test Suite ────────────────────────────────────────────────────────

describe("transaction mutations (delete + edit)", () => {
  beforeEach(async () => {
    idempotencyCounter = 0;
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ─── Group 1: destructive transaction deletion ─────────────────────

  describe("transaction delete preview and confirm", () => {
    it("rejects deletion without a versioned preview", async () => {
      const trade = await createTrade(app);

      const res = await app.inject({
        method: "DELETE",
        url: `/portfolio/transactions/${trade.id}`,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("dividend_destructive_preview_required");
    });

    it("rejects a deletion preview that targets a different transaction ID", async () => {
      const requestedTrade = await createTrade(app);
      const previewedTrade = await createTrade(app, { tradeDate: "2026-01-02" });
      const previewResponse = await app.inject({
        method: "POST",
        url: "/portfolio/transactions/mutations/delete-preview",
        payload: {
          reason: "Remove duplicate trade",
          items: [{ transactionId: previewedTrade.id }],
        },
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = previewResponse.json<{
        previewId: string;
        previewVersion: number;
        fingerprint: string;
      }>();

      const response = await app.inject({
        method: "DELETE",
        url: `/portfolio/transactions/${requestedTrade.id}`,
        payload: preview,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("posted_transaction_mutation_target_mismatch");
      const store = await getStore(app);
      expect(store.accounting.facts.tradeEvents.some((trade) => trade.id === requestedTrade.id)).toBe(true);
      expect(store.accounting.facts.tradeEvents.some((trade) => trade.id === previewedTrade.id)).toBe(true);
    });

    it("accepts a legacy dividend-delete preview through the DELETE alias", async () => {
      const trade = await createTrade(app);
      const previewResponse = await previewTradeDelete(app, trade.id);
      expect(previewResponse.statusCode).toBe(200);
      const preview = previewResponse.json<DestructivePreviewBody>();

      const response = await app.inject({
        method: "DELETE",
        url: `/portfolio/transactions/${trade.id}`,
        payload: {
          previewId: preview.preview.previewId,
          previewVersion: preview.preview.previewVersion,
          fingerprint: preview.preview.fingerprint,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<DestructivePreviewBody>().preview.previewId).toBe(preview.preview.previewId);
      const store = await getStore(app);
      expect(store.accounting.facts.tradeEvents.some((item) => item.id === trade.id)).toBe(false);
    });

    it("deletes a trade after confirmation and reports affected row counts", async () => {
      const trade = await createTrade(app);

      const { preview, confirmResponse } = await deleteTradeWithPreview(app, trade.id);
      const body = confirmResponse.json<DestructivePreviewBody>();
      expect(body.preview.previewId).toBe(preview.preview.previewId);
      expect(body.affectedCounts.cashLedgerEntries).toBe(1);
      // A standalone BUY has no lot allocations from sells
      expect(body.affectedCounts.lotAllocations).toBe(0);
    });

    it("rejects deleting a BUY required by downstream sells", async () => {
      const buy = await createTrade(app, { quantity: 10, unitPrice: 100 });
      await createTrade(app, {
        quantity: 5,
        unitPrice: 130,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });

      const response = await previewTradeDelete(app, buy.id);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);

      const store = await getStore(app);
      expect(store.accounting.facts.tradeEvents.some((trade) => trade.id === buy.id)).toBe(true);
    });

    it("replays the surviving history atomically on confirmation", async () => {
      await createTrade(app, { quantity: 10, unitPrice: 100 });
      const secondBuy = await createTrade(app, {
        quantity: 20,
        unitPrice: 120,
        tradeDate: "2026-01-02",
      });

      await deleteTradeWithPreview(app, secondBuy.id);

      // After recompute, only the first BUY remains
      const store = await getStore(app);
      const lots = store.accounting.projections.lots.filter(
        (l) => l.accountId === "acc-1" && l.ticker === "2330",
      );
      const totalQty = lots.reduce((sum, l) => sum + l.openQuantity, 0);
      expect(totalQty).toBe(10);
    });

    it("returns 404 for non-existent trade", async () => {
      const res = await previewTradeDelete(app, "nonexistent-id");

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("trade_event_not_found");
    });

    it("returns 404 for another user's trade (tenant isolation)", async () => {
      const trade = await createTrade(app);

      const res = await previewTradeDelete(app, trade.id, { "x-user-id": "other-user" });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Group 2: PATCH /portfolio/transactions/:id ─────────────────────

  describe("PATCH /portfolio/transactions/:id", () => {
    it("updates quantity and returns 202", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100 });

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 20 },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.changedFields).toContain("quantity");
      expect(body.updatedTradeEventId).toBe(trade.id);

      await waitForRecompute();
      const store = await getStore(app);
      const updatedTrade = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(updatedTrade?.quantity).toBe(20);
    });

    it("updates price and returns 202", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100 });

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { price: 150 },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json().changedFields).toContain("price");

      await waitForRecompute();
      const store = await getStore(app);
      const updatedTrade = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(updatedTrade?.unitPrice).toBe(150);
    });

    it("accepts decimal booked charges with up to 4 decimal places on patch", async () => {
      const trade = await createTrade(app, { commissionAmount: 1, taxAmount: 0 });

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: {
          commissionAmount: 1.2345,
          taxAmount: 0.4321,
        },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json().changedFields).toEqual(expect.arrayContaining(["commissionAmount", "taxAmount"]));

      await waitForRecompute();
      const store = await getStore(app);
      const updatedTrade = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(updatedTrade).toMatchObject({
        commissionAmount: 1.2345,
        taxAmount: 0.4321,
        feesSource: "MANUAL",
      });
    });

    it("rejects patch booked charges with more than 4 decimal places", async () => {
      const trade = await createTrade(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { commissionAmount: 1.23456 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: "validation_error",
      });
      expect(res.body).toContain("at most 4 decimal places");
    });

    it("recalculates fees when quantity changes with CALCULATED fees", async () => {
      // Create a fee profile with non-zero commission rate
      const fpRes = await app.inject({
        method: "POST",
        url: "/fee-profiles",
        payload: feeProfilePayload({
          name: "Nonzero Commission",
          boardCommissionRate: 1.425, // 0.1425% (permille)
        }),
      });
      expect(fpRes.statusCode).toBe(200);
      const feeProfileId = fpRes.json().id as string;

      // Bind the non-zero fee profile to acc-1/2330 so the trade snapshots it
      const bindRes = await app.inject({
        method: "PUT",
        url: "/fee-profile-bindings",
        payload: { bindings: [{ accountId: "acc-1", ticker: "2330", feeProfileId }] },
      });
      expect(bindRes.statusCode).toBe(200);

      const trade = await createTrade(app, { quantity: 10, unitPrice: 1000 });
      const originalCommission = trade.commissionAmount;

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 20 },
      });

      expect(res.statusCode).toBe(202);

      await waitForRecompute();
      const store = await getStore(app);
      const updatedTrade = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(updatedTrade).toBeDefined();
      // Fee recalculation must produce a non-zero commission that differs from the original
      expect(updatedTrade!.commissionAmount).toBeGreaterThan(0);
      expect(updatedTrade!.commissionAmount).not.toBe(originalCommission);
    });

    it("returns requiresFeeConfirmation when MANUAL fees and quantity changes", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100, commissionAmount: 50, taxAmount: 10 });

      // Directly set feesSource to MANUAL on the in-memory store
      const store = await getStore(app);
      const tradeInStore = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(tradeInStore).toBeDefined();
      tradeInStore!.feesSource = "MANUAL";

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 20 },
      });

      // Should return 200 with requiresFeeConfirmation, NOT 202
      expect(res.statusCode).toBe(200);
      expect(res.json().requiresFeeConfirmation).toBe(true);
    });

    it("proceeds with keepManualFees flag", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100, commissionAmount: 50, taxAmount: 10 });

      const store = await getStore(app);
      const tradeInStore = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      tradeInStore!.feesSource = "MANUAL";

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 20, keepManualFees: true },
      });

      expect(res.statusCode).toBe(202);

      await waitForRecompute();
      const updatedStore = await getStore(app);
      const updatedTrade = updatedStore.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      // Fees should remain unchanged
      expect(updatedTrade?.commissionAmount).toBe(50);
      expect(updatedTrade?.taxAmount).toBe(10);
    });

    it("requires confirmation before recalculating SOURCE_PROVIDED fees", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100, commissionAmount: 50, taxAmount: 10 });

      const store = await getStore(app);
      const tradeInStore = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(tradeInStore).toBeDefined();
      tradeInStore!.feesSource = "SOURCE_PROVIDED";

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 20 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ requiresFeeConfirmation: true, tradeEventId: trade.id });
    });

    it("preserves SOURCE_PROVIDED amounts and provenance when recorded fees are kept", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100, commissionAmount: 50, taxAmount: 10 });

      const store = await getStore(app);
      const tradeInStore = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(tradeInStore).toBeDefined();
      tradeInStore!.feesSource = "SOURCE_PROVIDED";

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 20, keepManualFees: true },
      });

      expect(res.statusCode).toBe(202);

      await waitForRecompute();
      const updatedStore = await getStore(app);
      const updatedTrade = updatedStore.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      expect(updatedTrade).toMatchObject({
        commissionAmount: 50,
        taxAmount: 10,
        feesSource: "SOURCE_PROVIDED",
      });
    });

    it("proceeds with confirmFeeRecalculation flag", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100, commissionAmount: 50, taxAmount: 10 });

      const store = await getStore(app);
      const tradeInStore = store.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      tradeInStore!.feesSource = "MANUAL";

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 20, confirmFeeRecalculation: true },
      });

      expect(res.statusCode).toBe(202);
    });

    it("handles date change with booking sequence compaction", async () => {
      // Create 3 trades on the same date with explicit booking sequences
      await createTrade(app, {
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:01.000Z",
        bookingSequence: 1,
      });
      const trade2 = await createTrade(app, {
        quantity: 10,
        unitPrice: 110,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:02.000Z",
        bookingSequence: 2,
      });
      await createTrade(app, {
        quantity: 10,
        unitPrice: 120,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:03.000Z",
        bookingSequence: 3,
      });

      // Move trade2 to a different date
      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade2.id}`,
        payload: { date: "2026-01-15" },
      });

      expect(res.statusCode).toBe(202);

      await waitForRecompute();
      const store = await getStore(app);

      // Old date (2026-01-01) should have compacted sequences [1, 2] (from [1, 3])
      const oldDateTrades = store.accounting.facts.tradeEvents
        .filter((t) => t.tradeDate === "2026-01-01")
        .sort((a, b) => (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
      expect(oldDateTrades).toHaveLength(2);
      expect(oldDateTrades.map((t) => t.bookingSequence)).toEqual([1, 2]);

      // New date (2026-01-15) should have the moved trade with sequence 1
      const newDateTrades = store.accounting.facts.tradeEvents.filter(
        (t) => t.tradeDate === "2026-01-15",
      );
      expect(newDateTrades).toHaveLength(1);
      expect(newDateTrades[0].id).toBe(trade2.id);
    });

    it("returns 400 for no changes", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100 });

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 10 }, // Same value → no changes
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("no_changes");
    });

    it("returns 404 for non-existent trade", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/portfolio/transactions/nonexistent-id",
        payload: { quantity: 5 },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("trade_event_not_found");
    });

    it("requires at least one editable field", async () => {
      const trade = await createTrade(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── Group 3: GET /portfolio/transactions/:id/preview-impact ────────

  describe("GET /portfolio/transactions/:id/preview-impact", () => {
    it("returns affected row counts for delete preview", async () => {
      const buy = await createTrade(app, { quantity: 10, unitPrice: 100 });
      await createTrade(app, {
        quantity: 5,
        unitPrice: 130,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });

      const savePreview = vi.spyOn(app.persistence, "savePostedTransactionMutationPreview");
      const res = await app.inject({
        method: "GET",
        url: `/portfolio/transactions/${buy.id}/preview-impact?action=delete`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.affectedRows.cashLedgerEntries).toBeGreaterThanOrEqual(1);
      expect(body.affectedRows.feePolicySnapshots).toBe(1);
      expect(body.negativeLots).toBeDefined();
      expect(savePreview).not.toHaveBeenCalled();
    });

    it("detects negative lots for delete", async () => {
      const buy = await createTrade(app, { quantity: 10, unitPrice: 100 });
      await createTrade(app, {
        quantity: 10,
        unitPrice: 130,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });

      const res = await app.inject({
        method: "GET",
        url: `/portfolio/transactions/${buy.id}/preview-impact?action=delete`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.negativeLots.wouldOccur).toBe(true);
      expect(body.negativeLots.resultingQuantity).toBe(-10);
      expect(body.negativeLots.ticker).toBe("2330");
    });

    it("detects an intermediate negative position even when the final quantity is nonnegative", async () => {
      const firstBuy = await createTrade(app, {
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-01",
      });
      await createTrade(app, {
        quantity: 5,
        unitPrice: 130,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });
      await createTrade(app, {
        quantity: 5,
        unitPrice: 110,
        tradeDate: "2026-01-03",
      });

      const res = await app.inject({
        method: "GET",
        url: `/portfolio/transactions/${firstBuy.id}/preview-impact?action=delete`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        negativeLots: {
          wouldOccur: true,
          resultingQuantity: 0,
          ticker: "2330",
        },
      });
      expect(res.json().blockers).toHaveLength(1);
    });

    it("no negative lots when safe delete", async () => {
      await createTrade(app, { quantity: 10, unitPrice: 100 });
      const secondBuy = await createTrade(app, {
        quantity: 5,
        unitPrice: 110,
        tradeDate: "2026-01-02",
      });

      const res = await app.inject({
        method: "GET",
        url: `/portfolio/transactions/${secondBuy.id}/preview-impact?action=delete`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().negativeLots.wouldOccur).toBe(false);
    });

    it("returns affected rows for patch preview", async () => {
      const buy = await createTrade(app, { quantity: 10, unitPrice: 100 });

      const res = await app.inject({
        method: "GET",
        url: `/portfolio/transactions/${buy.id}/preview-impact?action=patch&quantity=5`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.affectedRows).toBeDefined();
      expect(body.negativeLots.wouldOccur).toBe(false);
    });

    it("detects negative lots for side flip in patch preview", async () => {
      const buy = await createTrade(app, { quantity: 10, unitPrice: 100 });

      const res = await app.inject({
        method: "GET",
        url: `/portfolio/transactions/${buy.id}/preview-impact?action=patch&side=SELL`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().negativeLots.wouldOccur).toBe(true);
    });

    it("returns 404 for non-existent trade", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/portfolio/transactions/nonexistent-id/preview-impact?action=delete",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Group 4: Cascade Recompute — Golden Fixtures (Layer 1) ─────────

  describe("cascade recompute — golden fixtures", () => {
    it("3 BUYs, delete middle → correct weighted average", async () => {
      // Setup: BUY 100@50, BUY 200@60, BUY 150@55
      await createTrade(app, {
        quantity: 100,
        unitPrice: 50,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:01.000Z",
        bookingSequence: 1,
      });
      const buy2 = await createTrade(app, {
        quantity: 200,
        unitPrice: 60,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:02.000Z",
        bookingSequence: 2,
      });
      await createTrade(app, {
        quantity: 150,
        unitPrice: 55,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:03.000Z",
        bookingSequence: 3,
      });

      // Delete middle BUY (200@60)
      await deleteTradeWithPreview(app, buy2.id);

      // After delete + recompute, remaining: BUY 100@50 + BUY 150@55
      // Total qty = 250, total cost = 5000 + 8250 = 13250
      // Average cost = 13250 / 250 = 53.00
      // Lot normalization:
      //   Lot 1 (100 shares): round(13250 * 100 / 250) = round(5300) = 5300
      //   Lot 2 (150 shares): 13250 - 5300 = 7950
      const store = await getStore(app);
      const lots = store.accounting.projections.lots
        .filter((l) => l.accountId === "acc-1" && l.ticker === "2330" && l.openQuantity > 0)
        .sort((a, b) => (a.openedSequence ?? 0) - (b.openedSequence ?? 0));

      expect(lots).toHaveLength(2);

      const totalQty = lots.reduce((sum, l) => sum + l.openQuantity, 0);
      const totalCost = lots.reduce((sum, l) => sum + l.totalCostAmount, 0);
      expect(totalQty).toBe(250);
      expect(totalCost).toBe(13250);

      // Verify individual lot cost distribution
      expect(lots[0].openQuantity).toBe(100);
      expect(lots[0].totalCostAmount).toBe(5300);
      expect(lots[1].openQuantity).toBe(150);
      expect(lots[1].totalCostAmount).toBe(7950);
    });

    it("BUYs + SELL, delete a BUY → correct realized PnL", async () => {
      // Setup: BUY 100@50, BUY 100@60, SELL 50@80
      await createTrade(app, {
        quantity: 100,
        unitPrice: 50,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:01.000Z",
        bookingSequence: 1,
      });
      const buy2 = await createTrade(app, {
        quantity: 100,
        unitPrice: 60,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:02.000Z",
        bookingSequence: 2,
      });
      const sell = await createTrade(app, {
        quantity: 50,
        unitPrice: 80,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });

      // Delete the second BUY (100@60)
      await deleteTradeWithPreview(app, buy2.id);

      // After replay with only BUY 100@50 + SELL 50@80:
      // BUY creates lot: 100 shares, cost = 100*50 = 5000
      // SELL 50 shares: allocated cost = round(5000 * 50/100) = round(2500) = 2500
      //   Net proceeds = 50*80 - 0(commission) - 0(tax) = 4000
      //   Realized PnL = 4000 - 2500 = 1500
      // Remaining: 50 shares, cost = 5000 - 2500 = 2500
      const store = await getStore(app);
      const lots = store.accounting.projections.lots.filter(
        (l) => l.accountId === "acc-1" && l.ticker === "2330" && l.openQuantity > 0,
      );
      const totalQty = lots.reduce((sum, l) => sum + l.openQuantity, 0);
      const totalCost = lots.reduce((sum, l) => sum + l.totalCostAmount, 0);
      expect(totalQty).toBe(50);
      expect(totalCost).toBe(2500);

      // Verify realized PnL via lot allocations
      const sellAllocations = store.accounting.projections.lotAllocations.filter(
        (a) => a.tradeEventId === sell.id,
      );
      expect(sellAllocations).toHaveLength(1);
      expect(sellAllocations[0].allocatedQuantity).toBe(50);
      expect(sellAllocations[0].allocatedCostAmount).toBe(2500);
    });

    it("quantity edit → average cost recalculation", async () => {
      // Setup: BUY 100@50 → cost = 5000
      const trade = await createTrade(app, { quantity: 100, unitPrice: 50, commissionAmount: 0, taxAmount: 0 });

      // Set feesSource to MANUAL to prevent fee recalculation on PATCH (fees stay at 0)
      const editStore = await getStore(app);
      const editTrade = editStore.accounting.facts.tradeEvents.find((t) => t.id === trade.id);
      editTrade!.feesSource = "MANUAL";

      // PATCH quantity to 200
      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trade.id}`,
        payload: { quantity: 200, keepManualFees: true },
      });
      await waitForRecompute();

      // After replay: BUY 200@50 → cost = 200*50 = 10000 (fees=0)
      const store = await getStore(app);
      const lots = store.accounting.projections.lots.filter(
        (l) => l.accountId === "acc-1" && l.ticker === "2330" && l.openQuantity > 0,
      );
      expect(lots).toHaveLength(1);
      expect(lots[0].openQuantity).toBe(200);
      expect(lots[0].totalCostAmount).toBe(10000);
    });

    it("price edit → PnL shift on downstream sells", async () => {
      // Setup: BUY 100@50, SELL 50@80
      const buy = await createTrade(app, {
        quantity: 100,
        unitPrice: 50,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
      });
      const sell = await createTrade(app, {
        quantity: 50,
        unitPrice: 80,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });

      // Before edit: cost = 5000, SELL allocated cost = 2500, PnL = 4000 - 2500 = 1500
      // After edit BUY price to 70: cost = 7000, SELL allocated cost = round(7000*50/100) = 3500
      //   PnL = 4000 - 3500 = 500
      // Set feesSource to MANUAL to prevent fee recalculation on PATCH (fees stay at 0)
      const editStore = await getStore(app);
      const editBuy = editStore.accounting.facts.tradeEvents.find((t) => t.id === buy.id);
      editBuy!.feesSource = "MANUAL";

      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${buy.id}`,
        payload: { price: 70, keepManualFees: true },
      });
      await waitForRecompute();

      const store = await getStore(app);

      // Remaining lot: 50 shares, cost = 7000 - 3500 = 3500
      const lots = store.accounting.projections.lots.filter(
        (l) => l.accountId === "acc-1" && l.ticker === "2330" && l.openQuantity > 0,
      );
      expect(lots).toHaveLength(1);
      expect(lots[0].openQuantity).toBe(50);
      expect(lots[0].totalCostAmount).toBe(3500);

      // SELL allocation should reflect new cost basis
      const sellAllocations = store.accounting.projections.lotAllocations.filter(
        (a) => a.tradeEventId === sell.id,
      );
      expect(sellAllocations).toHaveLength(1);
      expect(sellAllocations[0].allocatedCostAmount).toBe(3500);
    });
  });

  // ─── Group 5: Replay Equivalence (Layer 2) ──────────────────────────

  describe("cascade recompute — replay equivalence", () => {
    it("book [A,B,C,D,E], delete C → equals fresh booking of [A,B,D,E]", async () => {
      // --- Run 1: Book all 5 trades, delete C, recompute ---
      const tradeConfigs = [
        { unitPrice: 50, quantity: 100, bookingSequence: 1, tradeTimestamp: "2026-01-01T09:00:01.000Z" },
        { unitPrice: 60, quantity: 80, bookingSequence: 2, tradeTimestamp: "2026-01-01T09:00:02.000Z" },
        { unitPrice: 55, quantity: 120, bookingSequence: 3, tradeTimestamp: "2026-01-01T09:00:03.000Z" }, // C — to delete
        { unitPrice: 70, quantity: 90, bookingSequence: 4, tradeTimestamp: "2026-01-01T09:00:04.000Z" },
        { unitPrice: 65, quantity: 110, bookingSequence: 5, tradeTimestamp: "2026-01-01T09:00:05.000Z" },
      ];

      const trades: Array<{ id: string }> = [];
      for (const config of tradeConfigs) {
        trades.push(
          await createTrade(app, { ...config, tradeDate: "2026-01-01", commissionAmount: 0, taxAmount: 0 }),
        );
      }

      // Delete trade C (index 2)
      await deleteTradeWithPreview(app, trades[2].id);

      const store1 = await getStore(app);

      // --- Run 2: Fresh booking of [A,B,D,E] ---
      const app2 = await buildApp({ persistenceBackend: "memory" });
      try {
        const remainingConfigs = [tradeConfigs[0], tradeConfigs[1], tradeConfigs[3], tradeConfigs[4]];
        let seq = 1;
        for (const config of remainingConfigs) {
          idempotencyCounter += 1;
          await app2.inject({
            method: "POST",
            url: "/portfolio/transactions",
            headers: { "idempotency-key": `k-equiv-${idempotencyCounter}` },
            payload: transactionPayload({
              ...config,
              bookingSequence: seq++,
              tradeDate: "2026-01-01",
              commissionAmount: 0,
              taxAmount: 0,
            }),
          });
        }

        const store2 = await app2.persistence.loadStore("user-1");

        // Compare financial quantities (NOT IDs/timestamps)
        const extractLotFinancials = (store: Awaited<ReturnType<typeof getStore>>) =>
          store.accounting.projections.lots
            .filter((l) => l.accountId === "acc-1" && l.ticker === "2330")
            .map((l) => ({ qty: l.openQuantity, cost: l.totalCostAmount }))
            .sort((a, b) => a.qty - b.qty || a.cost - b.cost);

        const extractCashAmounts = (store: Awaited<ReturnType<typeof getStore>>) =>
          store.accounting.facts.cashLedgerEntries
            .filter((e) => e.accountId === "acc-1" && e.entryType.startsWith("TRADE_SETTLEMENT"))
            .map((e) => e.amount)
            .sort((a, b) => a - b);

        expect(extractLotFinancials(store1)).toEqual(extractLotFinancials(store2));
        expect(extractCashAmounts(store1)).toEqual(extractCashAmounts(store2));
      } finally {
        await app2.close();
      }
    });

    it("PATCH quantity → equals fresh booking with modified trade", async () => {
      // --- Run 1: Book 3 BUYs, PATCH middle qty from 100→50, recompute ---
      const configs = [
        { unitPrice: 50, quantity: 100, bookingSequence: 1, tradeTimestamp: "2026-01-01T09:00:01.000Z" },
        { unitPrice: 60, quantity: 100, bookingSequence: 2, tradeTimestamp: "2026-01-01T09:00:02.000Z" }, // Will PATCH to qty=50
        { unitPrice: 55, quantity: 80, bookingSequence: 3, tradeTimestamp: "2026-01-01T09:00:03.000Z" },
      ];

      const trades: Array<{ id: string }> = [];
      for (const config of configs) {
        trades.push(await createTrade(app, { ...config, tradeDate: "2026-01-01", commissionAmount: 0, taxAmount: 0 }));
      }

      // Set feesSource to MANUAL on the trade being patched to prevent fee recalculation
      const patchStore = await getStore(app);
      const patchTrade = patchStore.accounting.facts.tradeEvents.find((t) => t.id === trades[1].id);
      patchTrade!.feesSource = "MANUAL";

      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${trades[1].id}`,
        payload: { quantity: 50, keepManualFees: true },
      });
      await waitForRecompute();

      const store1 = await getStore(app);

      // --- Run 2: Fresh booking with middle qty=50 ---
      const app2 = await buildApp({ persistenceBackend: "memory" });
      try {
        const freshConfigs = [
          configs[0],
          { ...configs[1], quantity: 50 }, // Modified
          configs[2],
        ];
        let seq = 1;
        for (const config of freshConfigs) {
          idempotencyCounter += 1;
          await app2.inject({
            method: "POST",
            url: "/portfolio/transactions",
            headers: { "idempotency-key": `k-equiv-patch-${idempotencyCounter}` },
            payload: transactionPayload({
              ...config,
              bookingSequence: seq++,
              tradeDate: "2026-01-01",
              commissionAmount: 0,
              taxAmount: 0,
            }),
          });
        }

        const store2 = await app2.persistence.loadStore("user-1");

        const extractLotFinancials = (store: Awaited<ReturnType<typeof getStore>>) =>
          store.accounting.projections.lots
            .filter((l) => l.accountId === "acc-1" && l.ticker === "2330")
            .map((l) => ({ qty: l.openQuantity, cost: l.totalCostAmount }))
            .sort((a, b) => a.qty - b.qty || a.cost - b.cost);

        expect(extractLotFinancials(store1)).toEqual(extractLotFinancials(store2));
      } finally {
        await app2.close();
      }
    });

    it("date reorder: PATCH date so trade moves after a SELL → correct replay order", async () => {
      // Run 1: BUY on Jan 1, BUY on Jan 3, SELL on Jan 5.
      // PATCH second BUY's date to Jan 6 (after the SELL).
      // Replay order becomes: BUY Jan 1, SELL Jan 5 (allocates only from first BUY), BUY Jan 6.
      await createTrade(app, {
        quantity: 100,
        unitPrice: 50,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
      });
      const buy2 = await createTrade(app, {
        quantity: 100,
        unitPrice: 60,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-03",
      });
      await createTrade(app, {
        quantity: 50,
        unitPrice: 80,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-05",
        type: "SELL" as TransactionType,
      });

      // Move buy2 to Jan 6 (after the sell)
      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${buy2.id}`,
        payload: { date: "2026-01-06" },
      });
      await waitForRecompute();

      const store1 = await getStore(app);

      // Run 2: Fresh booking in the correct final order: BUY Jan 1, SELL Jan 5, BUY Jan 6
      const app2 = await buildApp({ persistenceBackend: "memory" });
      try {
        await createTrade(app2, { quantity: 100, unitPrice: 50, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-01-01" });
        await createTrade(app2, {
          quantity: 50,
          unitPrice: 80,
          commissionAmount: 0,
          taxAmount: 0,
          tradeDate: "2026-01-05",
          type: "SELL" as TransactionType,
        });
        await createTrade(app2, { quantity: 100, unitPrice: 60, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-01-06" });

        const store2 = await app2.persistence.loadStore("user-1");

        // Compare lot financials
        const extractLotFinancials = (store: Awaited<ReturnType<typeof getStore>>) =>
          store.accounting.projections.lots
            .filter((l) => l.accountId === "acc-1" && l.ticker === "2330")
            .map((l) => ({ qty: l.openQuantity, cost: l.totalCostAmount }))
            .sort((a, b) => a.qty - b.qty || a.cost - b.cost);

        const extractCashAmounts = (store: Awaited<ReturnType<typeof getStore>>) =>
          store.accounting.facts.cashLedgerEntries
            .filter((e) => e.accountId === "acc-1" && e.entryType.startsWith("TRADE_SETTLEMENT"))
            .map((e) => e.amount)
            .sort((a, b) => a - b);

        expect(extractLotFinancials(store1)).toEqual(extractLotFinancials(store2));
        expect(extractCashAmounts(store1)).toEqual(extractCashAmounts(store2));
      } finally {
        await app2.close();
      }
    });

    it("booking sequence compaction: gap-free sequences after date change", async () => {
      // Create 3 trades on Jan 1 with sequences 1, 2, 3
      await createTrade(app, {
        quantity: 10,
        unitPrice: 100,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:01.000Z",
        bookingSequence: 1,
      });
      const t2 = await createTrade(app, {
        quantity: 10,
        unitPrice: 110,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:02.000Z",
        bookingSequence: 2,
      });
      await createTrade(app, {
        quantity: 10,
        unitPrice: 120,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:03.000Z",
        bookingSequence: 3,
      });

      // Move t2 to a new date
      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${t2.id}`,
        payload: { date: "2026-02-01" },
      });
      await waitForRecompute();

      const store = await getStore(app);

      // Jan 1 trades: should be compacted to [1, 2] (gap-free)
      const jan1Trades = store.accounting.facts.tradeEvents
        .filter((t) => t.tradeDate === "2026-01-01")
        .sort((a, b) => (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
      const sequences = jan1Trades.map((t) => t.bookingSequence);
      expect(sequences).toEqual([1, 2]);

      // Feb 1: should have 1 trade
      const feb1Trades = store.accounting.facts.tradeEvents.filter(
        (t) => t.tradeDate === "2026-02-01",
      );
      expect(feb1Trades).toHaveLength(1);
    });
  });

  // ─── Group 6: Edge Cases ────────────────────────────────────────────

  describe("edge cases", () => {
    it("delete-all trades for a symbol → zero lots, zero cash, no holding", async () => {
      const trade = await createTrade(app, { quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });

      await deleteTradeWithPreview(app, trade.id);

      const store = await getStore(app);

      // Zero lots for this symbol
      const lots = store.accounting.projections.lots.filter(
        (l) => l.accountId === "acc-1" && l.ticker === "2330",
      );
      expect(lots.filter((l) => l.openQuantity > 0)).toHaveLength(0);

      // Zero trade settlement cash entries for this symbol
      const cashEntries = store.accounting.facts.cashLedgerEntries.filter(
        (e) =>
          e.accountId === "acc-1" &&
          (e.entryType === "TRADE_SETTLEMENT_IN" || e.entryType === "TRADE_SETTLEMENT_OUT"),
      );
      expect(cashEntries).toHaveLength(0);

      // No holding projection
      const holdings = store.accounting.projections.holdings.filter(
        (h) => h.accountId === "acc-1" && h.ticker === "2330",
      );
      expect(holdings).toHaveLength(0);
    });

    it("negative lots: preview rejects deleting a BUY consumed by sells and preserves state", async () => {
      // BUY 100, then SELL 50 — if we delete the BUY, SELL has nothing to allocate from
      const buy = await createTrade(app, { quantity: 100, unitPrice: 50, commissionAmount: 0, taxAmount: 0 });
      await createTrade(app, {
        quantity: 50,
        unitPrice: 80,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });

      const response = await previewTradeDelete(app, buy.id);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);

      const store = await getStore(app);
      expect(store.accounting.facts.tradeEvents.some((trade) => trade.id === buy.id)).toBe(true);
    });

    it("BUY→SELL side flip with sufficient lots → correct state", async () => {
      // BUY 100@50 (seq 1), BUY 100@60 (seq 2)
      // Flip the second BUY to SELL → replay: BUY 100@50, then SELL 100@60
      await createTrade(app, {
        quantity: 100,
        unitPrice: 50,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:01.000Z",
        bookingSequence: 1,
      });
      const buy2 = await createTrade(app, {
        quantity: 100,
        unitPrice: 60,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:02.000Z",
        bookingSequence: 2,
      });

      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${buy2.id}`,
        payload: { side: "SELL" },
      });
      await waitForRecompute();

      const store = await getStore(app);

      // After replay: BUY 100@50 creates lot, SELL 100@60 consumes all
      // Remaining: 0 shares open
      // Realized PnL = (100*60) - (100*50) = 6000 - 5000 = 1000 (with zero fees)
      const lots = store.accounting.projections.lots.filter(
        (l) => l.accountId === "acc-1" && l.ticker === "2330",
      );
      const openQty = lots.reduce((sum, l) => sum + Math.max(0, l.openQuantity), 0);
      expect(openQty).toBe(0);

      // Verify sell allocation exists
      const sellAllocations = store.accounting.projections.lotAllocations.filter(
        (a) => a.ticker === "2330",
      );
      expect(sellAllocations).toHaveLength(1);
      expect(sellAllocations[0].allocatedQuantity).toBe(100);
      expect(sellAllocations[0].allocatedCostAmount).toBe(5000);
    });

    it("BUY→SELL side flip with insufficient lots → recompute_failed", async () => {
      // Single BUY 100@50 — flip it to SELL → no lots to sell from
      const buy = await createTrade(app, { quantity: 100, unitPrice: 50, commissionAmount: 0, taxAmount: 0 });

      const { events, unsub } = collectBusEvents(app);

      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${buy.id}`,
        payload: { side: "SELL" },
      });
      await waitForRecompute(500);
      unsub();

      const failedEvents = events.filter((e) => e.type === "recompute_failed");
      expect(failedEvents.length).toBeGreaterThanOrEqual(1);

      const data = failedEvents[failedEvents.length - 1].data as Record<string, unknown>;
      expect(data.retriesExhausted).toBe(true);
    });

    it("SELL→BUY side flip → lots increase", async () => {
      // BUY 100@50, SELL 50@80 → flip SELL to BUY
      // After replay: BUY 100@50 + BUY 50@80
      // Total qty = 150, total cost = 5000 + 4000 = 9000 (zero fees)
      await createTrade(app, {
        quantity: 100,
        unitPrice: 50,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-01",
      });
      const sell = await createTrade(app, {
        quantity: 50,
        unitPrice: 80,
        commissionAmount: 0,
        taxAmount: 0,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      });

      await app.inject({
        method: "PATCH",
        url: `/portfolio/transactions/${sell.id}`,
        payload: { side: "BUY" },
      });
      await waitForRecompute();

      const store = await getStore(app);
      const lots = store.accounting.projections.lots.filter(
        (l) => l.accountId === "acc-1" && l.ticker === "2330" && l.openQuantity > 0,
      );

      const totalQty = lots.reduce((sum, l) => sum + l.openQuantity, 0);
      const totalCost = lots.reduce((sum, l) => sum + l.totalCostAmount, 0);
      expect(totalQty).toBe(150);
      expect(totalCost).toBe(9000);

      // No realized PnL (no sells in the replayed history)
      const allocs = store.accounting.projections.lotAllocations.filter(
        (a) => a.ticker === "2330",
      );
      expect(allocs).toHaveLength(0);
    });
  });

  // ─── Group 7: destructive confirmation rollback ────────────────────

  describe("destructive confirmation rollback", () => {
    it("preserves the original trade when confirmation replay fails", async () => {
      await createTrade(app, { quantity: 10, unitPrice: 100 });
      const trade2 = await createTrade(app, {
        quantity: 20,
        unitPrice: 120,
        tradeDate: "2026-01-02",
      });
      const previewResponse = await previewTradeDelete(app, trade2.id);
      expect(previewResponse.statusCode).toBe(200);
      const preview = previewResponse.json<DestructivePreviewBody>();

      vi.spyOn(app.persistence, "saveAccountingStoreWithAudit").mockRejectedValue(
        new Error("Persistent atomic save failure"),
      );
      const confirmResponse = await confirmTradeDelete(app, trade2.id, preview);
      expect(confirmResponse.statusCode).toBeGreaterThanOrEqual(500);

      const store = await getStore(app);
      expect(store.accounting.facts.tradeEvents.some((trade) => trade.id === trade2.id)).toBe(true);
    });
  });
});
