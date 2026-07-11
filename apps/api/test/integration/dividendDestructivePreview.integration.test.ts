import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLogInput } from "../../src/persistence/types.js";
import { buildApp } from "../../src/app.js";
import {
  confirmAccountCutoffPurge,
  confirmTradeDividendDeletion,
  previewAccountCutoffPurge,
  previewTradeDividendDeletion,
} from "../../src/services/dividendDestructivePreview.js";
import { createDividendEvent, postDividend } from "../../src/services/dividends.js";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";

type PreviewBody = {
  preview: {
    previewId: string;
    previewVersion: number;
    fingerprint: string;
    consumedAt: string | null;
    consumedResult: string | null;
  };
  operation: {
    kind: "trade_delete" | "account_cutoff_purge";
    accountId: string;
    targetTradeEventId: string | null;
    cutoffDate: string | null;
    replayScopes: Array<{ accountId: string; ticker: string; marketCode: string; fromDate: string }>;
  };
  affectedGroups: {
    source: {
      tradeEventIds: string[];
      positionActionIds: string[];
    };
    derived: {
      dividendEventIds: string[];
      dividendLedgerEntryIds: string[];
      cashLedgerEntryIds: string[];
      dividendDeductionEntryIds: string[];
      dividendSourceLineIds: string[];
      stockDividendPositionActionIds: string[];
      holdingSnapshotIds: string[];
      lotAllocationTradeEventIds: string[];
    };
  };
  affectedCounts: {
    tradeEvents: number;
    positionActions: number;
    dividendLedgerEntries: number;
    cashLedgerEntries: number;
    dividendDeductionEntries: number;
    dividendSourceLines: number;
    lotAllocations: number;
    stockDividendPositionActions: number;
    holdingSnapshots: number;
  };
  affectedDividends: Array<{
    dividendEventId: string;
    dividendLedgerEntryId: string | null;
    cashLedgerEntryIds: string[];
    dividendDeductionEntryIds: string[];
    dividendSourceLineIds: string[];
    stockDividendPositionActionIds: string[];
    requiresManualReceiptReentry: boolean;
    beforeEligibleQuantity: number;
    afterEligibleQuantity: number;
  }>;
  manualReceiptReentryLedgerEntryIds: string[];
};

type ScenarioIds = {
  primaryPostedLedgerId: string;
  primaryCashLedgerEntryIds: string[];
  primaryDeductionEntryIds: string[];
  primarySourceLineIds: string[];
  primaryStockActionIds: string[];
  cutoffExpectedLedgerId: string;
  unaffectedExpectedLedgerId: string;
};

describe("dividend destructive preview", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedScenario(): Promise<ScenarioIds> {
    const store = await app.persistence.loadStore("user-1");
    const feeSnapshot = store.feeProfiles[0]!;

    store.accounting.facts.tradeEvents.push(
      {
        id: "trade-keep",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 1000,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot,
      },
      {
        id: "trade-delete",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 500,
        unitPrice: 102,
        priceCurrency: "TWD",
        tradeDate: "2026-01-03",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot,
      },
      {
        id: "trade-cutoff-delete",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 300,
        unitPrice: 103,
        priceCurrency: "TWD",
        tradeDate: "2026-03-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot,
      },
      {
        id: "trade-unaffected",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2317",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 700,
        unitPrice: 90,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot,
      },
    );
    store.accounting.facts.positionActions.push({
      id: "cutoff-split-action",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      actionType: "SPLIT",
      actionDate: "2026-03-02",
      actionTimestamp: "2026-03-02T09:00:00.000Z",
      bookedAt: "2026-03-02T09:00:00.000Z",
      quantity: 0,
      ratioNumerator: 2,
      ratioDenominator: 1,
      source: "test",
      sourceReference: "cutoff-split-action",
    });
    createDividendEvent(store, {
      id: "dividend-primary",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH_AND_STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0.1,
      stockDistributionAmountRaw: 0,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
      stockParValueAmount: 10,
      stockParValueCurrency: "TWD",
      source: "test",
    });
    createDividendEvent(store, {
      id: "dividend-cutoff",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-03-10",
      paymentDate: "2026-03-20",
      cashDividendPerShare: 2,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      stockDistributionAmountRaw: 0,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: null,
      stockParValueCurrency: null,
      source: "test",
    });
    createDividendEvent(store, {
      id: "dividend-unaffected",
      ticker: "2317",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-25",
      cashDividendPerShare: 1.5,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      stockDistributionAmountRaw: 0,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: null,
      stockParValueCurrency: null,
      source: "test",
    });
    await app.persistence.saveStore(store);

    await replayPositionHistory(app.persistence, "user-1", "acc-1", "2330", { marketCode: "TW" });
    await replayPositionHistory(app.persistence, "user-1", "acc-1", "2317", { marketCode: "TW" });

    const replayedStore = await app.persistence.loadStore("user-1");
    const postResult = postDividend(replayedStore, "user-1", {
      id: "primary-posting",
      accountId: "acc-1",
      dividendEventId: "dividend-primary",
      receivedCashAmount: 1450,
      receivedStockQuantity: 150,
      deductions: [{
        id: "primary-deduction-1",
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 50,
        currencyCode: "TWD",
        withheldAtSource: true,
        source: "test",
      }],
      sourceLines: [{
        id: "primary-source-line-1",
        sourceBucket: "DIVIDEND_INCOME",
        amount: 1500,
        currencyCode: "TWD",
        source: "issuer",
      }],
      sourceCompositionStatus: "provided",
    });
    replayedStore.accounting.facts.positionActions.push({
      id: "late-linked-stock-action",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      actionType: "STOCK_DIVIDEND",
      actionDate: "2026-03-05",
      quantity: 0,
      relatedDividendLedgerEntryId: postResult.dividendLedgerEntry.id,
      source: "test",
      sourceReference: "late-linked-stock-action",
    });
    replayedStore.accounting.projections.lots.push({
      id: "lot-pa-late-linked-stock-action",
      accountId: "acc-1",
      ticker: "2330",
      openQuantity: 25,
      totalCostAmount: 0,
      costCurrency: "TWD",
      openedAt: "2026-03-05",
      openedSequence: 99,
    });
    await app.persistence.saveStore(replayedStore);

    const seededStore = await app.persistence.loadStore("user-1");
    await app.persistence.bulkUpsertHoldingSnapshots("user-1", [{
      id: "snapshot-2330-after-delete",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      snapshotDate: "2026-01-03",
      quantity: 1500,
      closePrice: 102,
      marketValue: 153000,
      costBasis: 151000,
      unrealizedPnl: 2000,
      cumulativeRealizedPnl: 0,
      cumulativeDividends: 0,
      isProvisional: false,
      currency: "TWD",
      valueNative: 153000,
      costBasisNative: 151000,
      unrealizedPnlNative: 2000,
      providerSource: "test",
      generatedAt: "2026-01-03T10:00:00.000Z",
      generationRunId: "snapshot-run",
    }]);
    const primaryPosted = seededStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === "dividend-primary" && entry.postingStatus === "posted" && !entry.supersededAt,
    );
    const cutoffExpected = seededStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === "dividend-cutoff" && entry.postingStatus === "expected" && !entry.supersededAt,
    );
    const unaffectedExpected = seededStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === "dividend-unaffected" && entry.postingStatus === "expected" && !entry.supersededAt,
    );
    expect(primaryPosted).toBeTruthy();
    expect(cutoffExpected).toBeTruthy();
    expect(unaffectedExpected).toBeTruthy();

    return {
      primaryPostedLedgerId: primaryPosted!.id,
      primaryCashLedgerEntryIds: seededStore.accounting.facts.cashLedgerEntries
        .filter((entry) => entry.relatedDividendLedgerEntryId === primaryPosted!.id)
        .map((entry) => entry.id)
        .sort(),
      primaryDeductionEntryIds: seededStore.accounting.facts.dividendDeductionEntries
        .filter((entry) => entry.dividendLedgerEntryId === primaryPosted!.id)
        .map((entry) => entry.id)
        .sort(),
      primarySourceLineIds: seededStore.accounting.facts.dividendSourceLines
        .filter((entry) => entry.dividendLedgerEntryId === primaryPosted!.id)
        .map((entry) => entry.id)
        .sort(),
      primaryStockActionIds: seededStore.accounting.facts.positionActions
        .filter((entry) => entry.relatedDividendLedgerEntryId === primaryPosted!.id)
        .map((entry) => entry.id)
        .sort(),
      cutoffExpectedLedgerId: cutoffExpected!.id,
      unaffectedExpectedLedgerId: unaffectedExpected!.id,
    };
  }

  async function confirmTrade(preview: PreviewBody) {
    return confirmTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      previewId: preview.preview.previewId,
      previewVersion: preview.preview.previewVersion,
      fingerprint: preview.preview.fingerprint,
      tradeEventId: preview.operation.targetTradeEventId!,
    });
  }

  async function confirmCutoff(preview: PreviewBody) {
    return confirmAccountCutoffPurge(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      previewId: preview.preview.previewId,
      previewVersion: preview.preview.previewVersion,
      fingerprint: preview.preview.fingerprint,
      accountId: preview.operation.accountId,
    });
  }

  it("enumerates exact affected ids for single delete and regenerates expected state while preserving unaffected rows", async () => {
    const ids = await seedScenario();

    const preview = await previewTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-delete",
      reason: "Remove duplicate buy",
    });
    const previewBody = preview as PreviewBody;

    expect(previewBody.operation).toMatchObject({
      kind: "trade_delete",
      accountId: "acc-1",
      targetTradeEventId: "trade-delete",
    });
    expect(previewBody.affectedGroups.source).toEqual({
      tradeEventIds: ["trade-delete"],
      positionActionIds: [],
    });
    expect(previewBody.affectedGroups.derived.dividendEventIds).toEqual(["dividend-cutoff", "dividend-primary"]);
    expect(previewBody.affectedGroups.derived.dividendLedgerEntryIds).toEqual([
      ids.cutoffExpectedLedgerId,
      ids.primaryPostedLedgerId,
    ].sort());
    expect(previewBody.affectedGroups.derived.cashLedgerEntryIds).toEqual(ids.primaryCashLedgerEntryIds);
    expect(previewBody.affectedGroups.derived.dividendDeductionEntryIds).toEqual(ids.primaryDeductionEntryIds);
    expect(previewBody.affectedGroups.derived.dividendSourceLineIds).toEqual(ids.primarySourceLineIds);
    expect(previewBody.affectedGroups.derived.stockDividendPositionActionIds).toEqual(ids.primaryStockActionIds);
    expect(previewBody.manualReceiptReentryLedgerEntryIds).toEqual([ids.primaryPostedLedgerId]);
    expect(previewBody.affectedCounts.holdingSnapshots).toBe(1);
    expect(previewBody.affectedGroups.derived.holdingSnapshotIds).toEqual(["snapshot-2330-after-delete"]);
    expect(previewBody.operation.replayScopes).toEqual([{
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-01-03",
    }]);
    expect(previewBody.affectedDividends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dividendEventId: "dividend-primary",
          dividendLedgerEntryId: ids.primaryPostedLedgerId,
          cashLedgerEntryIds: ids.primaryCashLedgerEntryIds,
          dividendDeductionEntryIds: ids.primaryDeductionEntryIds,
          dividendSourceLineIds: ids.primarySourceLineIds,
          stockDividendPositionActionIds: ids.primaryStockActionIds,
          requiresManualReceiptReentry: true,
          beforeEligibleQuantity: 1500,
          afterEligibleQuantity: 1000,
          afterExpectedCashAmount: 1000,
          afterExpectedStockQuantity: 100,
        }),
        expect.objectContaining({
          dividendEventId: "dividend-cutoff",
          dividendLedgerEntryId: ids.cutoffExpectedLedgerId,
          requiresManualReceiptReentry: false,
          beforeEligibleQuantity: 3600,
          afterEligibleQuantity: 2900,
        }),
      ]),
    );

    const confirmed = await confirmTrade(previewBody);
    expect(confirmed.preview.consumedResult).toBe("confirmed");

    const auditEntries = await app.persistence.listAuditLog({
      page: 1,
      limit: 20,
      actions: ["dividend_destructive_preview_created", "dividend_destructive_confirmed"],
    });
    expect(auditEntries.items).toHaveLength(2);
    for (const auditEntry of auditEntries.items) {
      expect(auditEntry.metadata).not.toHaveProperty("affectedDividends");
      expect(auditEntry.metadata).not.toHaveProperty("manualReceiptReentryLedgerEntryIds");
      expect(auditEntry.metadata).not.toHaveProperty("reviewedArtifacts");
    }

    const updatedStore = await app.persistence.loadStore("user-1");
    expect(updatedStore.accounting.facts.tradeEvents.some((entry) => entry.id === "trade-delete")).toBe(false);
    expect(updatedStore.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === ids.primaryPostedLedgerId)).toBe(false);
    expect(updatedStore.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === ids.cutoffExpectedLedgerId)).toBe(false);
    expect(updatedStore.accounting.facts.cashLedgerEntries.some((entry) => ids.primaryCashLedgerEntryIds.includes(entry.id))).toBe(false);
    expect(updatedStore.accounting.facts.dividendDeductionEntries.some((entry) => ids.primaryDeductionEntryIds.includes(entry.id))).toBe(false);
    expect(updatedStore.accounting.facts.dividendSourceLines.some((entry) => ids.primarySourceLineIds.includes(entry.id))).toBe(false);
    expect(updatedStore.accounting.facts.positionActions.some((entry) => ids.primaryStockActionIds.includes(entry.id))).toBe(false);
    expect(await app.persistence.countHoldingSnapshotsAfterDate("user-1", "acc-1", "2330", "2026-01-03", "TW")).toBe(0);

    const regeneratedPrimary = updatedStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === "dividend-primary" && entry.postingStatus === "expected" && !entry.supersededAt,
    );
    const regeneratedCutoff = updatedStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === "dividend-cutoff" && entry.postingStatus === "expected" && !entry.supersededAt,
    );
    const unaffected = updatedStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === ids.unaffectedExpectedLedgerId,
    );
    expect(regeneratedPrimary).toMatchObject({
      eligibleQuantity: 1000,
      expectedCashAmount: 1000,
      expectedStockQuantity: 100,
      postingStatus: "expected",
    });
    expect(regeneratedCutoff).toMatchObject({
      eligibleQuantity: 2600,
      expectedCashAmount: 5200,
      postingStatus: "expected",
    });
    expect(unaffected?.id).toBe(ids.unaffectedExpectedLedgerId);
  });

  it("enumerates cutoff source ids and regenerates only the cutoff-affected expectation", async () => {
    const ids = await seedScenario();

    const preview = await previewAccountCutoffPurge(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      accountId: "acc-1",
      cutoffDate: "2026-03-01",
      reason: "Remove bad March history",
    });
    const previewBody = preview as PreviewBody;

    expect(previewBody.operation).toMatchObject({
      kind: "account_cutoff_purge",
      accountId: "acc-1",
      cutoffDate: "2026-03-01",
    });
    expect(previewBody.affectedGroups.source).toEqual({
      tradeEventIds: ["trade-cutoff-delete"],
      positionActionIds: ["cutoff-split-action", "late-linked-stock-action"],
    });
    expect(previewBody.affectedGroups.derived.dividendEventIds).toEqual(["dividend-cutoff", "dividend-primary"]);
    expect(previewBody.affectedGroups.derived.dividendLedgerEntryIds).toEqual([
      ids.cutoffExpectedLedgerId,
      ids.primaryPostedLedgerId,
    ].sort());
    expect(previewBody.affectedCounts).toMatchObject({
      tradeEvents: 1,
      positionActions: 2,
      dividendLedgerEntries: 2,
    });

    const confirmed = await confirmCutoff(previewBody);
    expect(confirmed.preview.consumedResult).toBe("confirmed");

    const updatedStore = await app.persistence.loadStore("user-1");
    expect(updatedStore.accounting.facts.tradeEvents.some((entry) => entry.id === "trade-cutoff-delete")).toBe(false);
    expect(updatedStore.accounting.facts.positionActions.some((entry) => entry.id === "cutoff-split-action")).toBe(false);
    expect(updatedStore.accounting.projections.lots.some((entry) => entry.id === "lot-pa-late-linked-stock-action")).toBe(false);
    expect(updatedStore.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === ids.cutoffExpectedLedgerId)).toBe(false);

    const regeneratedCutoff = updatedStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === "dividend-cutoff" && entry.postingStatus === "expected" && !entry.supersededAt,
    );
    const regeneratedPrimary = updatedStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === "dividend-primary" && entry.postingStatus === "expected" && !entry.supersededAt,
    );
    expect(regeneratedCutoff).toMatchObject({
      eligibleQuantity: 1500,
      expectedCashAmount: 3000,
      postingStatus: "expected",
    });
    expect(updatedStore.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === ids.primaryPostedLedgerId)).toBe(false);
    expect(regeneratedPrimary).toMatchObject({
      eligibleQuantity: 1500,
      expectedCashAmount: 1500,
      expectedStockQuantity: 150,
      postingStatus: "expected",
    });
  });

  it("rejects stale and consumed previews", async () => {
    await seedScenario();

    const firstPreview = await previewTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-delete",
      reason: "First review",
    });
    const secondPreview = await previewTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-delete",
      reason: "Second review",
    });

    await expect(confirmTrade(firstPreview as PreviewBody)).rejects.toMatchObject({
      code: "dividend_destructive_preview_stale",
      statusCode: 409,
    });

    const latestPreview = secondPreview as PreviewBody;
    const confirmed = await confirmTrade(latestPreview);
    expect(confirmed.preview.consumedResult).toBe("confirmed");

    await expect(confirmTrade(latestPreview)).rejects.toMatchObject({
      code: "dividend_destructive_preview_consumed",
      statusCode: 409,
    });
  });

  it("binds confirmations to their operation kind and route resource", async () => {
    await seedScenario();
    const tradePreview = await previewTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-delete",
      reason: "Resource binding",
    }) as PreviewBody;

    await expect(confirmAccountCutoffPurge(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      accountId: "acc-1",
      previewId: tradePreview.preview.previewId,
      previewVersion: tradePreview.preview.previewVersion,
      fingerprint: tradePreview.preview.fingerprint,
    })).rejects.toMatchObject({
      code: "dividend_destructive_preview_resource_mismatch",
      statusCode: 409,
    });

    await expect(confirmTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-keep",
      previewId: tradePreview.preview.previewId,
      previewVersion: tradePreview.preview.previewVersion,
      fingerprint: tradePreview.preview.fingerprint,
    })).rejects.toMatchObject({
      code: "dividend_destructive_preview_resource_mismatch",
      statusCode: 409,
    });
  });

  it("rejects stale cutoff previews and rolls back cutoff state plus snapshots on persistence failure", async () => {
    await seedScenario();
    await app.persistence.bulkUpsertHoldingSnapshots("user-1", [{
      id: "snapshot-cutoff",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      snapshotDate: "2026-03-05",
      quantity: 1800,
      closePrice: 103,
      marketValue: 185400,
      costBasis: 181900,
      unrealizedPnl: 3500,
      cumulativeRealizedPnl: 0,
      cumulativeDividends: 0,
      isProvisional: false,
      currency: "TWD",
      valueNative: 185400,
      costBasisNative: 181900,
      unrealizedPnlNative: 3500,
      providerSource: "test",
      generatedAt: "2026-03-05T10:00:00.000Z",
      generationRunId: "cutoff-run",
    }]);
    const first = await previewAccountCutoffPurge(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      accountId: "acc-1",
      cutoffDate: "2026-03-01",
      reason: "First cutoff",
    }) as PreviewBody;
    const latest = await previewAccountCutoffPurge(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      accountId: "acc-1",
      cutoffDate: "2026-03-01",
      reason: "Latest cutoff",
    }) as PreviewBody;

    await expect(confirmCutoff(first)).rejects.toMatchObject({
      code: "dividend_destructive_preview_stale",
      statusCode: 409,
    });

    const persistence = app.persistence as typeof app.persistence & {
      appendAuditLog(input: AuditLogInput): Promise<void>;
    };
    const originalAppendAuditLog = persistence.appendAuditLog.bind(persistence);
    persistence.appendAuditLog = async (input) => {
      if (input.action === "dividend_destructive_confirmed") {
        throw new Error("forced cutoff persistence failure");
      }
      return originalAppendAuditLog(input);
    };
    await expect(confirmCutoff(latest)).rejects.toThrow("forced cutoff persistence failure");
    persistence.appendAuditLog = originalAppendAuditLog;

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents.some((entry) => entry.id === "trade-cutoff-delete")).toBe(true);
    expect(await app.persistence.countHoldingSnapshotsAfterDate("user-1", "acc-1", "2330", "2026-03-01", "TW")).toBe(1);
  });

  it("rejects drifted previews without mutating state", async () => {
    const ids = await seedScenario();

    const preview = await previewTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-delete",
      reason: "Review before drift",
    });
    const previewBody = preview as PreviewBody;

    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push({
      id: "trade-drift",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 1,
      unitPrice: 99,
      priceCurrency: "TWD",
      tradeDate: "2026-01-04",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    await app.persistence.saveStore(store);

    await expect(confirmTrade(previewBody)).rejects.toMatchObject({
      code: "dividend_destructive_preview_row_drift",
      statusCode: 409,
    });

    const after = await app.persistence.loadStore("user-1");
    expect(after.accounting.facts.tradeEvents.some((entry) => entry.id === "trade-delete")).toBe(true);
    expect(after.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === ids.primaryPostedLedgerId)).toBe(true);
  });

  it("rejects amount-only accounting drift against the preview-time revision", async () => {
    const ids = await seedScenario();
    const preview = await previewTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-delete",
      reason: "Review before amount drift",
    }) as PreviewBody;

    const store = await app.persistence.loadStore("user-1");
    const deduction = store.accounting.facts.dividendDeductionEntries.find(
      (entry) => ids.primaryDeductionEntryIds.includes(entry.id),
    );
    expect(deduction).toBeDefined();
    deduction!.amount += 1;
    await app.persistence.saveStore(store);

    await expect(confirmTrade(preview)).rejects.toMatchObject({
      code: "dividend_destructive_preview_row_drift",
      statusCode: 409,
    });
    const after = await app.persistence.loadStore("user-1");
    expect(after.accounting.facts.tradeEvents.some((entry) => entry.id === "trade-delete")).toBe(true);
  });

  it("rolls back the memory store when audited confirm persistence fails", async () => {
    const ids = await seedScenario();

    const preview = await previewTradeDividendDeletion(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      tradeEventId: "trade-delete",
      reason: "Force rollback",
    });
    const previewBody = preview as PreviewBody;

    const persistence = app.persistence as typeof app.persistence & {
      appendAuditLog(input: AuditLogInput): Promise<void>;
    };
    const originalAppendAuditLog = persistence.appendAuditLog.bind(persistence);
    persistence.appendAuditLog = async (input) => {
      if (input.action === "dividend_destructive_confirmed") {
        throw new Error("forced_audit_failure");
      }
      return originalAppendAuditLog(input);
    };

    await expect(confirmTrade(previewBody)).rejects.toThrow("forced_audit_failure");
    persistence.appendAuditLog = originalAppendAuditLog;

    const after = await app.persistence.loadStore("user-1");
    expect(after.accounting.facts.tradeEvents.some((entry) => entry.id === "trade-delete")).toBe(true);
    expect(after.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === ids.primaryPostedLedgerId)).toBe(true);
    expect(after.accounting.facts.cashLedgerEntries.some((entry) => ids.primaryCashLedgerEntryIds.includes(entry.id))).toBe(true);

    const failedPreview = await app.persistence.getDividendDestructivePreview(previewBody.preview.previewId);
    expect(failedPreview).toMatchObject({
      consumedResult: "failed",
    });
  });
});
