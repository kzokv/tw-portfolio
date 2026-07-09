import type { DashboardOverviewHoldingChildDto, DashboardOverviewHoldingGroupDto, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { DividendLedgerEntryDetails } from "../dividends/types";

export interface HoldingActionTimelineItem {
  id: string;
  kind: "stock_dividend" | "cash_in_lieu" | "buy" | "sell";
  title: string;
  date: string;
  timeLabel: string | null;
  badgeTone: "neutral" | "success" | "warning";
  badgeLabel: string;
  description: string;
  accountLabel: string | null;
  linkedDividendId: string | null;
  linkedActionId: string | null;
  amendBlocked: boolean;
  orderingNote: string | null;
}

export interface SplitPreviewLineItem {
  accountId: string;
  accountLabel: string;
  beforeQuantity: number;
  afterQuantity: number;
  fractionalQuantity: number;
}

export interface SplitPreviewResult {
  afterQuantity: number;
  averageCost: number | null;
  blocked: boolean;
  blockingReason: "fractional_cash_in_lieu_required" | null;
  fractionalQuantity: number;
  ratioLabel: string;
}

export function buildHoldingActionTimelineItems(params: {
  dividendEntries: DividendLedgerEntryDetails[];
  transactions: TransactionHistoryItemDto[];
}): HoldingActionTimelineItem[] {
  const dividendItems = params.dividendEntries.flatMap((entry) => {
    const items: HoldingActionTimelineItem[] = [];
    const accountLabel = entry.accountName?.trim() || entry.accountId;
    const timeLabel = formatTimeLabel(entry.bookedAt);
    const orderingNote = entry.linkedPositionActionId
      ? null
      : entry.amendmentBlockedReason
        ? "replay_after_sell"
        : null;

    if (entry.receivedStockQuantity > 0) {
      items.push({
        id: `stock-dividend:${entry.id}`,
        kind: "stock_dividend",
        title: "stock_dividend_posted",
        date: entry.paymentDate ?? entry.exDividendDate,
        timeLabel,
        badgeTone: entry.amendmentBlockedReason ? "warning" : "success",
        badgeLabel: entry.amendmentBlockedReason ? "amend_blocked" : "stock_dividend",
        description: buildStockDividendDescription(entry),
        accountLabel,
        linkedDividendId: entry.id,
        linkedActionId: entry.linkedPositionActionId ?? null,
        amendBlocked: Boolean(entry.amendmentBlockedReason),
        orderingNote,
      });
    }

    const cashInLieuAmount = resolveCashInLieuAmount(entry);
    if (cashInLieuAmount > 0) {
      items.push({
        id: `cash-in-lieu:${entry.id}`,
        kind: "cash_in_lieu",
        title: "cash_in_lieu_recorded",
        date: entry.paymentDate ?? entry.exDividendDate,
        timeLabel,
        badgeTone: "neutral",
        badgeLabel: "cash_in_lieu",
        description: `cash_in_lieu:${cashInLieuAmount}:${entry.cashCurrency}`,
        accountLabel,
        linkedDividendId: entry.id,
        linkedActionId: entry.linkedPositionActionId ?? null,
        amendBlocked: Boolean(entry.amendmentBlockedReason),
        orderingNote: null,
      });
    }

    return items;
  });

  const transactionItems: HoldingActionTimelineItem[] = params.transactions.map((transaction) => ({
    id: `trade:${transaction.id}`,
    kind: transaction.type === "BUY" ? "buy" : "sell",
    title: transaction.type === "BUY" ? "buy_trade" : "sell_trade",
    date: transaction.tradeDate,
    timeLabel: formatTimeLabel(transaction.tradeTimestamp),
    badgeTone: transaction.type === "BUY" ? "success" : "neutral",
    badgeLabel: transaction.type === "BUY" ? "open_lot" : "trade",
    description: `trade:${transaction.quantity}:${transaction.unitPrice}:${transaction.priceCurrency}`,
    accountLabel: transaction.accountName?.trim() || transaction.accountId,
    linkedDividendId: null,
    linkedActionId: null,
    amendBlocked: false,
    orderingNote: null,
  }));

  return [...dividendItems, ...transactionItems].sort(compareTimelineItems);
}

export function buildSplitPreview(params: {
  costBasis: number | null;
  currentQuantity: number;
  numerator: number;
  denominator: number;
  cashInLieuAmount: number | null;
}): SplitPreviewResult {
  const ratio = params.denominator === 0 ? 0 : params.numerator / params.denominator;
  const rawAfter = params.currentQuantity * ratio;
  const retainedQuantity = Math.floor(rawAfter);
  const afterQuantity = roundTo(rawAfter === retainedQuantity ? rawAfter : retainedQuantity, 6);
  const fractionalQuantity = roundTo(Math.max(0, rawAfter - Math.floor(rawAfter)), 6);
  const hasFraction = fractionalQuantity > 0;
  const requiresLotLevelCashInLieu = params.denominator > params.numerator && params.numerator > 0;
  const blocked = (hasFraction || requiresLotLevelCashInLieu) && (params.cashInLieuAmount ?? 0) <= 0;

  return {
    afterQuantity,
    averageCost: params.costBasis != null && afterQuantity > 0 ? roundTo(params.costBasis / afterQuantity, 4) : null,
    blocked,
    blockingReason: blocked ? "fractional_cash_in_lieu_required" : null,
    fractionalQuantity,
    ratioLabel: `${params.denominator}:${params.numerator}`,
  };
}

export function buildSplitPreviewLineItems(children: DashboardOverviewHoldingGroupDto["children"]): SplitPreviewLineItem[] {
  return children.map((child) => ({
    accountId: child.accountId,
    accountLabel: child.accountName?.trim() || child.accountId,
    beforeQuantity: child.quantity,
    afterQuantity: child.quantity,
    fractionalQuantity: 0,
  }));
}

export function applySplitPreviewToLineItems(
  items: SplitPreviewLineItem[],
  numerator: number,
  denominator: number,
): SplitPreviewLineItem[] {
  const ratio = denominator === 0 ? 0 : numerator / denominator;
  return items.map((item) => {
    const rawAfter = item.beforeQuantity * ratio;
    const retainedQuantity = Math.floor(rawAfter);
    return {
      ...item,
      afterQuantity: roundTo(rawAfter === retainedQuantity ? rawAfter : retainedQuantity, 6),
      fractionalQuantity: roundTo(Math.max(0, rawAfter - Math.floor(rawAfter)), 6),
    };
  });
}

export function getHoldingChildren(row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto): DashboardOverviewHoldingGroupDto["children"] {
  if ("children" in row) return row.children;
  return [row];
}

function compareTimelineItems(left: HoldingActionTimelineItem, right: HoldingActionTimelineItem): number {
  const dateCompare = left.date.localeCompare(right.date);
  if (dateCompare !== 0) return dateCompare;

  const leftTime = left.timeLabel ?? "";
  const rightTime = right.timeLabel ?? "";
  if (left.kind !== right.kind && (!leftTime || !rightTime)) {
    return isPositionEffect(left) ? -1 : 1;
  }

  const timeCompare = leftTime.localeCompare(rightTime);
  if (timeCompare !== 0) return timeCompare;

  if (left.kind !== right.kind) {
    return isPositionEffect(left) ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
}

function isPositionEffect(item: HoldingActionTimelineItem): boolean {
  return item.kind === "stock_dividend" || item.kind === "cash_in_lieu";
}

function buildStockDividendDescription(entry: DividendLedgerEntryDetails): string {
  const parts = [
    `shares:${entry.receivedStockQuantity}`,
    `cost:${entry.portfolioCostBasisAddedAmount ?? 0}:${entry.cashCurrency}`,
  ];

  const premiumBaseAmount = resolvePremiumBaseAmount(entry);
  if (premiumBaseAmount !== null) {
    parts.push(`premium:${premiumBaseAmount}:${entry.cashCurrency}`);
  }

  return parts.join("|");
}

function resolveCashInLieuAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.cashInLieuAmount != null) return entry.cashInLieuAmount;
  return entry.deductions
    .filter((deduction) => deduction.deductionType === "CASH_IN_LIEU_ADJUSTMENT")
    .reduce((sum, deduction) => sum + deduction.amount, 0);
}

function resolvePremiumBaseAmount(entry: DividendLedgerEntryDetails): number | null {
  if (entry.nhiPremiumBaseAmount != null) return entry.nhiPremiumBaseAmount;
  if (entry.parValueBaseAmount != null && entry.premiumBaseAmount != null) {
    return entry.parValueBaseAmount + entry.premiumBaseAmount;
  }
  if (entry.parValueBaseAmount != null) return entry.parValueBaseAmount;
  return null;
}

function formatTimeLabel(value?: string | null): string | null {
  if (!value) return null;
  const timeMatch = value.match(/T(\d{2}:\d{2})/);
  if (timeMatch) return timeMatch[1] ?? null;
  const looseMatch = value.match(/\b(\d{2}:\d{2})/);
  return looseMatch?.[1] ?? null;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
