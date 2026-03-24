"use client";

import { useEffect, useRef } from "react";
import { getApiBaseUrl } from "../lib/api";

export interface UseEventStreamOptions {
  /** @deprecated Use eventTypes instead */
  eventType?: string;
  /** Array of SSE event types to listen for */
  eventTypes?: string[];
  onEvent: (data: unknown) => void;
  onReconnect?: (gap: { lastReceivedId: number; currentId: number }) => void;
  onError?: (error: Event) => void;
  enabled?: boolean;
}

const MAX_RETRIES = 5;

export function useEventStream({
  eventType,
  eventTypes,
  onEvent,
  onReconnect,
  onError,
  enabled = true,
}: UseEventStreamOptions): void {
  const lastEventIdRef = useRef<number>(0);
  const retryCountRef = useRef<number>(0);
  const shouldReconnectRef = useRef<boolean>(true);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const types = eventTypes ?? (eventType ? [eventType] : []);
  const typesKey = JSON.stringify(types);

  useEffect(() => {
    if (!enabled || types.length === 0) return;

    shouldReconnectRef.current = true;
    retryCountRef.current = 0;

    const url = `${getApiBaseUrl()}/events/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.addEventListener("open", () => {
      retryCountRef.current = 0;
    });

    function handleEvent(event: MessageEvent) {
      const currentId = parseInt(event.lastEventId, 10);

      if (lastEventIdRef.current > 0 && currentId === 1) {
        onReconnectRef.current?.({
          lastReceivedId: lastEventIdRef.current,
          currentId,
        });
      }

      if (!isNaN(currentId)) {
        lastEventIdRef.current = currentId;
      }

      try {
        const data = JSON.parse(event.data);
        onEventRef.current(data);
      } catch {
        onEventRef.current(event.data);
      }
    }

    for (const type of types) {
      eventSource.addEventListener(type, handleEvent);
    }

    eventSource.addEventListener("heartbeat", (event: MessageEvent) => {
      const currentId = parseInt(event.lastEventId, 10);

      if (lastEventIdRef.current > 0 && currentId === 1) {
        onReconnectRef.current?.({
          lastReceivedId: lastEventIdRef.current,
          currentId,
        });
      }

      if (!isNaN(currentId)) {
        lastEventIdRef.current = currentId;
      }
    });

    eventSource.addEventListener("error", (event: MessageEvent) => {
      if (event.data) {
        try {
          const errorData = JSON.parse(event.data) as { code?: string };
          if (errorData.code === "connection_limit_exceeded") {
            shouldReconnectRef.current = false;
            eventSource.close();
            return;
          }
        } catch {
          // Not JSON — fall through
        }
      }
    });

    eventSource.onerror = (event) => {
      onErrorRef.current?.(event);
      retryCountRef.current++;

      if (retryCountRef.current >= MAX_RETRIES || !shouldReconnectRef.current) {
        eventSource.close();
      }
    };

    return () => {
      shouldReconnectRef.current = false;
      eventSource.close();
    };
  }, [typesKey, enabled]);
}
