import type { Page } from "@playwright/test";

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
