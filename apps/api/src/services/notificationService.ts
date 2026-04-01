import type { NotificationSeverity } from "@tw-portfolio/shared-types";
import type { Persistence } from "../persistence/types.js";
import type { EventBus } from "../events/types.js";

export function deriveSeverity(succeeded: number, failed: number): NotificationSeverity {
  if (failed === 0) return "info";
  if (succeeded === 0) return "error";
  return "warning";
}

export interface BatchCompleteContext {
  persistence: Pick<Persistence, "getUsersMonitoringTicker" | "createNotification">;
  eventBus: Pick<EventBus, "publishEvent">;
  batchId: string;
  tickerResults: Record<string, { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string }>;
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export async function handleBatchComplete(ctx: BatchCompleteContext): Promise<void> {
  const { persistence, eventBus, batchId, tickerResults, log } = ctx;

  const tickers = Object.keys(tickerResults);
  if (tickers.length === 0) return;

  // Collect unique users across all tickers
  const userTickers = new Map<string, Set<string>>();
  await Promise.all(
    tickers.map(async (ticker) => {
      const userIds = await persistence.getUsersMonitoringTicker(ticker);
      for (const userId of userIds) {
        let set = userTickers.get(userId);
        if (!set) {
          set = new Set();
          userTickers.set(userId, set);
        }
        set.add(ticker);
      }
    }),
  );

  // Fan out: one notification per user
  for (const [userId, monitoredSet] of userTickers) {
    const userResults: Record<string, typeof tickerResults[string]> = {};
    let succeeded = 0;
    let failed = 0;

    for (const ticker of monitoredSet) {
      const result = tickerResults[ticker];
      if (!result) continue;
      userResults[ticker] = result;
      if (result.status === "success") succeeded++;
      else failed++;
    }

    const total = succeeded + failed;
    if (total === 0) continue;

    const severity = deriveSeverity(succeeded, failed);
    const title = buildTitle(severity, succeeded, failed);
    const body = buildBody(severity, userResults);

    try {
      await persistence.createNotification({
        userId,
        severity,
        source: "daily_refresh",
        sourceRef: batchId,
        title,
        body,
        detail: userResults,
      });
    } catch (err) {
      log?.warn({ userId, batchId, err }, "notification_create_failed");
    }

    try {
      await eventBus.publishEvent(userId, "daily_refresh_summary", {
        batchId,
        totalTickers: total,
        succeeded,
        failed,
        severity,
      });
    } catch (err) {
      log?.warn({ userId, batchId, err }, "sse_summary_publish_failed");
    }
  }

  log?.info({ batchId, usersNotified: userTickers.size }, "batch_complete_notifications_sent");
}

function buildTitle(severity: NotificationSeverity, succeeded: number, failed: number): string {
  const total = succeeded + failed;
  if (severity === "info") return `Daily refresh completed — ${total} ticker${total > 1 ? "s" : ""} updated`;
  if (severity === "error") return `Daily refresh failed — ${failed} ticker${failed > 1 ? "s" : ""} failed`;
  return `Daily refresh completed with issues — ${failed} of ${total} failed`;
}

function buildBody(severity: NotificationSeverity, results: Record<string, { status: string; reason?: string }>): string | undefined {
  if (severity === "info") return undefined;
  const failedEntries = Object.entries(results).filter(([, r]) => r.status === "failed");
  return failedEntries.map(([ticker, r]) => `${ticker}: ${r.reason ?? "unknown error"}`).join(", ");
}
