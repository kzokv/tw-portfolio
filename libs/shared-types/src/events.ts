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
  portfolioId?: string;
}

// Discriminated union
export type SSEEvent = HeartbeatEvent | SSEErrorEvent | RecomputeCompleteEvent;

// System types (used internally for SSE wire format)
export type SSESystemEventType = "heartbeat" | "error";
export type SSEDomainEventType = "recompute_complete";
export type SSEEventType = SSESystemEventType | SSEDomainEventType;
