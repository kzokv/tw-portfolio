// System event types
export interface HeartbeatEvent {
  type: "heartbeat";
}

export interface SSEErrorEvent {
  type: "error";
  code: string;
  message?: string;
}

// Domain event types
export interface RecomputeCompleteEvent {
  type: "recompute_complete";
  accountId: string;
  ticker: string;
  updatedHoldings: {
    openQuantity: number;
    averageCost: number;
    totalRealizedPnl: number;
    totalCommission: number;
    totalTax: number;
  };
  cashBalanceChange: number;
  lotsRecalculated: number;
  affectedTradeCount: number;
}

export interface RecomputeFailedEvent {
  type: "recompute_failed";
  accountId: string;
  ticker: string;
  reason: string;
  retriesExhausted: boolean;
}

// Backfill event types (KZO-126)
export interface BackfillStartedEvent {
  type: "backfill_started";
  ticker: string;
}

export interface BackfillCompleteEvent {
  type: "backfill_complete";
  ticker: string;
  barsCount: number;
  dividendsCount: number;
}

export interface BackfillFailedEvent {
  type: "backfill_failed";
  ticker: string;
  reason: string;
  retriesExhausted: boolean;
}

export interface RepairStartedEvent {
  type: "repair_started";
  ticker: string;
}

export interface RepairCompleteEvent {
  type: "repair_complete";
  ticker: string;
  barsCount: number;
  dividendsCount: number;
}

export interface RepairFailedEvent {
  type: "repair_failed";
  ticker: string;
  reason: string;
  retriesExhausted: boolean;
}

export interface DailyRefreshCompleteEvent {
  type: "daily_refresh_complete";
  ticker: string;
  barsCount: number;
  dividendsCount: number;
}

export interface DailyRefreshFailedEvent {
  type: "daily_refresh_failed";
  ticker: string;
  reason: string;
}

export interface DailyRefreshSummaryEvent {
  type: "daily_refresh_summary";
  batchId: string;
  totalTickers: number;
  succeeded: number;
  failed: number;
  severity: "info" | "warning" | "error";
}

export interface DividendPostedEvent {
  type: "dividend_posted";
  dividendLedgerEntryId: string;
  dividendEventId: string;
  accountId: string;
  version: number;
}

export interface DividendUpdatedEvent {
  type: "dividend_updated";
  dividendLedgerEntryId: string;
  dividendEventId: string;
  accountId: string;
  version: number;
}

export interface DividendReconciliationChangedEvent {
  type: "dividend_reconciliation_changed";
  dividendLedgerEntryId: string;
  dividendEventId: string;
  accountId: string;
  reconciliationStatus: "open" | "matched" | "explained" | "resolved";
  version: number;
}

// Discriminated union
export type SSEEvent =
  | HeartbeatEvent
  | SSEErrorEvent
  | RecomputeCompleteEvent
  | RecomputeFailedEvent
  | BackfillStartedEvent
  | BackfillCompleteEvent
  | BackfillFailedEvent
  | RepairStartedEvent
  | RepairCompleteEvent
  | RepairFailedEvent
  | DailyRefreshCompleteEvent
  | DailyRefreshFailedEvent
  | DailyRefreshSummaryEvent
  | DividendPostedEvent
  | DividendUpdatedEvent
  | DividendReconciliationChangedEvent;

// System types (used internally for SSE wire format)
export type SSESystemEventType = "heartbeat" | "error";
export type SSEDomainEventType =
  | "recompute_complete"
  | "recompute_failed"
  | "backfill_started"
  | "backfill_complete"
  | "backfill_failed"
  | "repair_started"
  | "repair_complete"
  | "repair_failed"
  | "daily_refresh_complete"
  | "daily_refresh_failed"
  | "daily_refresh_summary"
  | "dividend_posted"
  | "dividend_updated"
  | "dividend_reconciliation_changed";
export type SSEEventType = SSESystemEventType | SSEDomainEventType;
