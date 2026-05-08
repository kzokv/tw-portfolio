// KZO-177 — provider health aggregator.
//
// Centralizes status computation, error-trail bookkeeping, and admin
// notification fan-out for the four data providers (`finmind-tw`,
// `finmind-us`, `yahoo-finance-au`, `frankfurter`). Workers call
// `recordOutcome(persistence, { providerId, outcome })` after each provider
// call. Provider classes themselves stay pure (no health side effects); the
// worker is the integration point.
//
// Status thresholds (computed-on-read counters; trail is authoritative):
//   - healthy:  last_successful_run >= latestSettledTradingDay(market)
//               AND error_count_24h === 0
//   - degraded: last_successful_run >= latestSettledTradingDay(market)
//               AND error_count_24h >= 1
//   - down:     last_successful_run <  latestSettledTradingDay(market)
//               (includes NULL)
//
// 24h-suppressed `provider_down` notifications + CAS-gated
// `provider_recovered` notifications.

import type { MarketCode } from "@tw-portfolio/domain";
import type { Persistence, ProviderErrorClass } from "../../persistence/types.js";
import { getEffectiveDownNotificationSuppressionMs } from "../appConfig/providerHealth.js";
import {
  latestSettledTradingDayPure,
  TradingCalendarCache,
  type SettleOptions,
} from "./tradingCalendar.js";

export type ProviderId =
  | "finmind-tw"
  | "finmind-us"
  | "yahoo-finance-au"
  | "twelve-data-au"
  | "frankfurter";

export type ProviderOutcomeKind = "success" | "rate_limit" | "error";

export interface ProviderOutcome {
  kind: ProviderOutcomeKind;
  errorClass?: ProviderErrorClass;
  errorMessage?: string;
  context?: Record<string, unknown>;
}

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const NOOP_LOG: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// KZO-198: replaced module-level constant with the resolver below. Keep the
// line intentionally absent — `getEffectiveDownNotificationSuppressionMs()` is
// the single source of truth (cache → env-fallback).

// ── Provider id ↔ market mapping ────────────────────────────────────────────

export function calendarMarketForProvider(providerId: ProviderId): MarketCode | "FX" {
  switch (providerId) {
    case "finmind-tw":
      return "TW";
    case "finmind-us":
      return "US";
    case "yahoo-finance-au":
      return "AU";
    // KZO-200: Twelve Data is the AU catalog provider (KZO-194). It runs on the
    // catalog-sync cadence (cron `CATALOG_SYNC_CRON`, weekday 17:30 UTC) but
    // its health-status freshness is measured against the AU calendar — same
    // settled-trading-day yardstick as `yahoo-finance-au`.
    case "twelve-data-au":
      return "AU";
    case "frankfurter":
      return "FX";
  }
}

// ── Pure status computation ────────────────────────────────────────────────

export interface ComputeStatusInput {
  lastSuccessfulRun: string | null;
  errorCount24h: number;
  latestSettledTradingDay: string;
}

/**
 * Pure status computation. Object-arg form preferred; legacy positional form
 * accepted for backward compatibility with the Backend Implementer's own
 * tests.
 */
export function computeStatus(input: ComputeStatusInput): "healthy" | "degraded" | "down";
export function computeStatus(
  lastSuccessfulRun: string | null,
  latestSettledTradingDay: string,
  errorCount24h: number,
): "healthy" | "degraded" | "down";
export function computeStatus(
  arg1: ComputeStatusInput | (string | null),
  arg2?: string,
  arg3?: number,
): "healthy" | "degraded" | "down" {
  let lastSuccessfulRun: string | null;
  let latestSettledTradingDay: string;
  let errorCount24h: number;
  if (typeof arg1 === "object" && arg1 !== null) {
    lastSuccessfulRun = arg1.lastSuccessfulRun;
    latestSettledTradingDay = arg1.latestSettledTradingDay;
    errorCount24h = arg1.errorCount24h;
  } else {
    lastSuccessfulRun = arg1 as string | null;
    latestSettledTradingDay = arg2 ?? "";
    errorCount24h = arg3 ?? 0;
  }
  const lastSuccessDay = lastSuccessfulRun ? lastSuccessfulRun.slice(0, 10) : null;
  if (!lastSuccessDay || lastSuccessDay < latestSettledTradingDay) return "down";
  return errorCount24h === 0 ? "healthy" : "degraded";
}

// ── Internal aggregator ─────────────────────────────────────────────────────

interface AggregatorDeps {
  persistence: Pick<
    Persistence,
    | "getProviderHealthStatus"
    | "upsertProviderHealthStatus"
    | "clearProviderDownNotificationCas"
    | "claimProviderDownNotificationSlot"
    | "insertProviderErrorTrailEntry"
    | "computeErrorCount24h"
    | "listAdminUserIds"
    | "createNotification"
  >;
  log?: Logger;
  /** Optional injected calendar — defaults to the Pure helper using zero
   *  trading-date cache (treats every weekday as a trading day). */
  resolveLatestSettledTradingDay?: (market: MarketCode | "FX", now: Date) => Promise<string>;
  now?: () => Date;
}

async function fanOutAdminNotification(
  deps: AggregatorDeps,
  severity: "info" | "warning" | "error",
  title: string,
  body: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const log = deps.log ?? NOOP_LOG;
  try {
    const adminUserIds = await deps.persistence.listAdminUserIds();
    await Promise.all(
      adminUserIds.map((userId) =>
        deps.persistence
          .createNotification({
            userId,
            severity,
            source: "provider_health",
            title,
            body,
            detail,
          })
          .catch((err: unknown) => {
            log.warn(
              { err, userId, providerId: detail.providerId },
              "provider_health_notification_create_failed",
            );
          }),
      ),
    );
  } catch (err) {
    log.warn({ err }, "provider_health_admin_fanout_failed");
  }
}

function defaultResolveLatestSettledTradingDay(
  market: MarketCode | "FX",
  now: Date,
  options: SettleOptions = {},
): string {
  // Light fallback: empty trading-date set treats every weekday as a trading
  // day. Workers go through the FastifyInstance's `tradingCalendarCache`
  // wrapper (via the service factory) which caches the real
  // `getDistinctBarDates` results.
  return latestSettledTradingDayPure(new Set(), market, now, options);
}

async function recordOutcomeImpl(
  deps: AggregatorDeps,
  args: { providerId: ProviderId; outcome: ProviderOutcome },
): Promise<void> {
  const { providerId, outcome } = args;
  const log = deps.log ?? NOOP_LOG;
  const now = deps.now ?? (() => new Date());
  const market = calendarMarketForProvider(providerId);

  const previous = await deps.persistence.getProviderHealthStatus(providerId);
  if (!previous) {
    log.warn({ providerId }, "provider_health_status_row_missing");
    return;
  }

  if (outcome.kind === "rate_limit") {
    await deps.persistence.insertProviderErrorTrailEntry({
      providerId,
      errorClass: "rate_limit",
      errorMessage: outcome.errorMessage ?? null,
      context: outcome.context ?? null,
    });
    return;
  }

  const nowIso = now().toISOString();
  const resolveSettled = deps.resolveLatestSettledTradingDay
    ?? (async (m: MarketCode | "FX", n: Date) => defaultResolveLatestSettledTradingDay(m, n));

  if (outcome.kind === "error") {
    await deps.persistence.insertProviderErrorTrailEntry({
      providerId,
      errorClass: outcome.errorClass ?? "other",
      errorMessage: outcome.errorMessage ?? null,
      context: outcome.context ?? null,
    });
    const errorCount24h = await deps.persistence.computeErrorCount24h(providerId);
    const latestSettled = await resolveSettled(market, now());
    const newStatus = computeStatus({
      lastSuccessfulRun: previous.lastSuccessfulRun,
      latestSettledTradingDay: latestSettled,
      errorCount24h,
    });
    await deps.persistence.upsertProviderHealthStatus({
      providerId,
      status: newStatus,
      lastFailedRun: nowIso,
      lastErrorMessage: outcome.errorMessage ?? null,
    });

    if (newStatus === "down") {
      // KZO-177 (P2 Fix 5): atomic claim — only one concurrent worker wins the
      // notification slot. The conditional UPDATE inside
      // `claimProviderDownNotificationSlot` enforces the 24h suppression
      // window in a single SQL round-trip; losers get false and skip the
      // fan-out without firing duplicate notifications.
      const claimed = await deps.persistence.claimProviderDownNotificationSlot(
        providerId,
        getEffectiveDownNotificationSuppressionMs(),
      );
      if (claimed) {
        await fanOutAdminNotification(
          deps,
          "error",
          `Provider down — ${providerId}`,
          outcome.errorMessage ?? `${providerId} is failing health checks.`,
          { providerId, status: newStatus, errorMessage: outcome.errorMessage ?? null },
        );
      }
    }
    return;
  }

  // outcome.kind === "success"
  const errorCount24h = await deps.persistence.computeErrorCount24h(providerId);
  const latestSettled = await resolveSettled(market, now());
  const newStatus = computeStatus({
    lastSuccessfulRun: nowIso,
    latestSettledTradingDay: latestSettled,
    errorCount24h,
  });
  await deps.persistence.upsertProviderHealthStatus({
    providerId,
    status: newStatus,
    lastSuccessfulRun: nowIso,
  });

  // KZO-177 (P2 Fix 4): only fire recovery on a clean `healthy` transition.
  // `degraded` means the provider is up but recently produced an error — that
  // is NOT a recovery and should not clear the down-notification suppression
  // key (otherwise the next `down` flap fires a duplicate within 24h).
  if (
    newStatus === "healthy" &&
    previous.status === "down" &&
    previous.lastDownNotificationAt !== null
  ) {
    const won = await deps.persistence.clearProviderDownNotificationCas(
      providerId,
      previous.lastDownNotificationAt,
    );
    if (won) {
      await fanOutAdminNotification(
        deps,
        "info",
        `Provider recovered — ${providerId}`,
        `${providerId} is healthy again.`,
        { providerId, status: newStatus },
      );
    }
  }
}

// ── Public free function (test-friendly) ────────────────────────────────────

/**
 * Record an outcome for a provider. Free-function form — pass the persistence
 * directly. Fastify wiring uses the `ProviderHealthService` factory below
 * which closes over a per-instance trading calendar cache.
 */
export async function recordOutcome(
  persistence: AggregatorDeps["persistence"],
  args: { providerId: ProviderId; outcome: ProviderOutcome },
): Promise<void> {
  await recordOutcomeImpl({ persistence }, args);
}

// ── Service factory (used by Fastify wiring) ───────────────────────────────

export interface ProviderHealthService {
  recordOutcome(providerId: ProviderId, outcome: ProviderOutcome): Promise<void>;
}

export interface ProviderHealthDeps {
  persistence: AggregatorDeps["persistence"];
  tradingCalendar: Pick<TradingCalendarCache, "latestSettledTradingDay">;
  log: Logger;
  now?: () => Date;
}

export function createProviderHealthService(deps: ProviderHealthDeps): ProviderHealthService {
  return {
    async recordOutcome(providerId, outcome): Promise<void> {
      await recordOutcomeImpl(
        {
          persistence: deps.persistence,
          log: deps.log,
          now: deps.now,
          resolveLatestSettledTradingDay: (market, now) =>
            deps.tradingCalendar.latestSettledTradingDay(market, now),
        },
        { providerId, outcome },
      );
    },
  };
}
