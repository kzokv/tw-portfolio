import type { APIRequestContext, Page } from "@playwright/test";

import { apiUrl } from "./url.js";

export interface TSseProbeResult {
  data: unknown;
  event: string;
  eventId: string | null;
  received: boolean;
}

interface TSseProbeOptions {
  targetEvent: string;
  timeoutMs?: number;
  url: string;
}

const DEFAULT_SSE_TIMEOUT_MS = 10_000;

export async function openSseProbe(page: Page, options: TSseProbeOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;

  await page.evaluate(({ targetEvent, timeoutMs, url }) => {
    const browserGlobal = globalThis as typeof globalThis & {
      __twSseProbe?: {
        ready: boolean;
        result: {
          data: unknown;
          event: string;
          eventId: string | null;
          received: boolean;
        } | null;
      };
    };

    const setProbe = (next: NonNullable<typeof browserGlobal.__twSseProbe>) => {
      browserGlobal.__twSseProbe = next;
    };

    const markReady = () => {
      setProbe({
        ready: true,
        result: browserGlobal.__twSseProbe?.result ?? null,
      });
    };

    setProbe({ ready: false, result: null });

    const es = new EventSource(url, { withCredentials: true });
    const finish = (result: NonNullable<typeof browserGlobal.__twSseProbe>["result"]) => {
      clearTimeout(timeoutId);
      es.close();
      setProbe({ ready: true, result });
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        data: null,
        event: "timeout",
        eventId: null,
        received: false,
      });
    }, timeoutMs);

    es.onopen = () => {
      markReady();
    };

    es.addEventListener("heartbeat", (event) => {
      markReady();
      if (targetEvent === "heartbeat") {
        finish({
          data: event.data,
          event: "heartbeat",
          eventId: event.lastEventId || null,
          received: true,
        });
      }
    });

    if (targetEvent !== "heartbeat") {
      es.addEventListener(targetEvent, (event) => {
        finish({
          data: JSON.parse(event.data),
          event: targetEvent,
          eventId: event.lastEventId || null,
          received: true,
        });
      });
    }

    es.onerror = () => {
      if (!browserGlobal.__twSseProbe?.result) {
        finish({
          data: null,
          event: "error",
          eventId: null,
          received: false,
        });
      }
    };
  }, { ...options, timeoutMs });

  await page.waitForFunction(() => {
    const browserGlobal = globalThis as typeof globalThis & {
      __twSseProbe?: { ready: boolean };
    };
    return browserGlobal.__twSseProbe?.ready === true;
  }, undefined, { timeout: timeoutMs });
}

export async function waitForSseProbeResult(
  page: Page,
  timeoutMs = DEFAULT_SSE_TIMEOUT_MS,
): Promise<TSseProbeResult> {
  const handle = await page.waitForFunction(() => {
    const browserGlobal = globalThis as typeof globalThis & {
      __twSseProbe?: { result: unknown };
    };
    return browserGlobal.__twSseProbe?.result ?? null;
  }, undefined, { timeout: timeoutMs });

  try {
    return await handle.jsonValue() as TSseProbeResult;
  } finally {
    await handle.dispose();
  }
}

interface TPublishAndExpectSseEventOptions {
  /** Playwright request context for the publish POST */
  request: APIRequestContext;
  /** Playwright page with the SSE probe already navigated to an authenticated route */
  page: Page;
  /** SSE event type to listen for (e.g. "recompute_complete") */
  eventType: string;
  /** Payload for the published event */
  eventData: Record<string, unknown>;
  /** Auth headers for the publish request (e.g. `{ "x-user-id": id }` or `{ cookie: "..." }`) */
  authHeaders: Record<string, string>;
  /** Timeout for both probe and wait (default: 10s) */
  timeoutMs?: number;
}

/**
 * Open an SSE probe, publish an event via the synthetic endpoint, and return the received result.
 * The page must already be navigated to an authenticated route before calling this.
 */
export async function publishAndExpectSseEvent(
  options: TPublishAndExpectSseEventOptions,
): Promise<TSseProbeResult> {
  const { request, page, eventType, eventData, authHeaders, timeoutMs } = options;
  const sseUrl = apiUrl("/events/stream");

  await openSseProbe(page, {
    url: sseUrl,
    targetEvent: eventType,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });

  const publishRes = await request.post(apiUrl("/__test/publish-event"), {
    headers: { "content-type": "application/json", ...authHeaders },
    data: { type: eventType, data: eventData },
  });
  if (!publishRes.ok()) {
    throw new Error(`publish-event failed: ${publishRes.status()} ${await publishRes.text()}`);
  }

  return waitForSseProbeResult(page, timeoutMs);
}
