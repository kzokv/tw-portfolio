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

// Discriminated union
export type SSEEvent =
  | HeartbeatEvent
  | SSEErrorEvent
  | RecomputeCompleteEvent
  | RecomputeFailedEvent
  | BackfillStartedEvent
  | BackfillCompleteEvent
  | BackfillFailedEvent
  | DailyRefreshCompleteEvent
  | DailyRefreshFailedEvent;

// System types (used internally for SSE wire format)
export type SSESystemEventType = "heartbeat" | "error";
export type SSEDomainEventType =
  | "recompute_complete"
  | "recompute_failed"
  | "backfill_started"
  | "backfill_complete"
  | "backfill_failed"
  | "daily_refresh_complete"
  | "daily_refresh_failed";
export type SSEEventType = SSESystemEventType | SSEDomainEventType;
