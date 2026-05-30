export type EventHandler = (event: { type: string; data: unknown; seq?: number }) => void;
export type Unsubscribe = () => void;

export interface EventBus {
  /** Publish an event to a user's channel. */
  publishEvent(userId: string, type: string, payload: unknown): Promise<void>;

  /** Subscribe to a user's channel. Returns an unsubscribe function. */
  subscribe(userId: string, handler: EventHandler): Unsubscribe;

  /** Graceful shutdown — close connections, clear listeners. */
  close(): Promise<void>;
}
