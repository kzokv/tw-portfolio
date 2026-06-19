import { randomUUID } from "node:crypto";
import type {
  AdminMarketCalendarConfirmResponse,
  AdminMarketCalendarHistoryResponse,
  AdminMarketCalendarPreviewRequest,
  AdminMarketCalendarPreviewResponse,
  AdminMarketCalendarStatusResponse,
} from "@vakwen/shared-types";
import type { MarketCode } from "@vakwen/domain";
import type {
  MarketCalendarExceptionInput,
  MarketCalendarVersionRecord,
  Persistence,
} from "../../persistence/types.js";
import { routeError } from "../../lib/routeError.js";
import { getMarketLocalParts, type RegularSessionMarketCode } from "./marketRegularSession.js";

export interface OfficialCalendarDayStatus {
  marketCode: RegularSessionMarketCode;
  localDate: string;
  calendarYear: number;
  status: "open" | "closed" | "calendar_unknown";
  reason: "not_trading_day" | "calendar_unknown";
}

const SUPPORTED_MARKETS = new Set<RegularSessionMarketCode>(["TW", "US", "AU", "KR"]);

const DEFAULT_SOURCE_URLS: Record<RegularSessionMarketCode, string> = {
  TW: "https://www.twse.com.tw/en/trading/holiday.html",
  US: "https://www.nasdaqtrader.com/trader.aspx?id=Calendar",
  AU: "https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar",
  KR: "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp",
};

const LOW_EXCEPTION_WARNING_THRESHOLD = 2;
const HIGH_EXCEPTION_WARNING_THRESHOLD = 30;

type MarketCalendarSourceUpdateInput = {
  label?: string;
  sourceType?: "official_source" | "manual_ai_assisted";
  suggestedSourceUrl?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
};

export function isOfficialCalendarMarketCode(marketCode: MarketCode): marketCode is RegularSessionMarketCode {
  return SUPPORTED_MARKETS.has(marketCode as RegularSessionMarketCode);
}

export function resolveCalendarExceptionMap(
  exceptions: ReadonlyArray<MarketCalendarExceptionInput>,
): Map<string, MarketCalendarExceptionInput> {
  return new Map(exceptions.map((exception) => [exception.date, exception]));
}

export function isWeekendIsoDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isWeekdayIsoDate(date: string): boolean {
  return !isWeekendIsoDate(date);
}

export function resolveMarketCalendarDayStatus(
  version: MarketCalendarVersionRecord | null,
  localDate: string,
): "open" | "closed" | "calendar_unknown" {
  if (!version || version.status !== "confirmed" || !version.isActive) return "calendar_unknown";
  const exception = resolveCalendarExceptionMap(version.exceptions).get(localDate);
  if (exception) return exception.status;
  return isWeekdayIsoDate(localDate) ? "open" : "closed";
}

export async function getOfficialCalendarDayStatus(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  at: Date,
): Promise<OfficialCalendarDayStatus> {
  const { localDate } = getMarketLocalParts(marketCode, at);
  const calendarYear = Number(localDate.slice(0, 4));
  const version = await persistence.getActiveMarketCalendarVersion(marketCode, calendarYear);
  const status = resolveMarketCalendarDayStatus(version, localDate);
  if (status === "calendar_unknown") {
    return { marketCode, localDate, calendarYear, status, reason: "calendar_unknown" };
  }
  return { marketCode, localDate, calendarYear, status, reason: "not_trading_day" };
}

export async function buildAdminMarketCalendarStatus(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  now: Date,
): Promise<AdminMarketCalendarStatusResponse> {
  const { localDate } = getMarketLocalParts(marketCode, now);
  const currentYear = Number(localDate.slice(0, 4));
  const years = await Promise.all([currentYear, currentYear + 1].map(async (calendarYear) => {
    const active = await persistence.getActiveMarketCalendarVersion(marketCode, calendarYear);
    if (!active) {
      return {
        marketCode,
        calendarYear,
        status: "missing" as const,
        sourceLabel: null,
        sourceType: null,
        activeVersionId: null,
        retrievedAt: null,
        confirmedAt: null,
        invalidatedAt: null,
        openDayCount: 0,
        closedDayCount: 0,
        updatedAt: null,
      };
    }
    return {
      marketCode,
      calendarYear,
      status: active.status === "confirmed" ? "confirmed" as const : "invalidated" as const,
      sourceLabel: active.sourceLabel,
      sourceType: active.sourceType,
      activeVersionId: active.isActive ? active.versionId : null,
      retrievedAt: active.retrievedAt,
      confirmedAt: active.confirmedAt,
      invalidatedAt: active.invalidatedAt,
      openDayCount: active.annualCounts.tradingDayCount,
      closedDayCount: active.annualCounts.nonTradingDayCount,
      updatedAt: active.updatedAt,
    };
  }));
  return {
    marketCode,
    localDate,
    years,
    sources: (await persistence.listMarketCalendarSources(marketCode)).map((source) => ({
      ...source,
      marketCode,
    })),
  };
}

export async function previewAdminMarketCalendarImport(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  request: AdminMarketCalendarPreviewRequest,
): Promise<AdminMarketCalendarPreviewResponse> {
  const source = await resolveCalendarPreviewSource(persistence, marketCode, request.sourceId);
  const sourceType = request.sourceType ?? source?.sourceType ?? "manual_ai_assisted";
  const label = request.label?.trim() || source?.label || null;
  const sourceUrl = normalizeSourceUrlOrNull(request.sourceUrl)
    ?? normalizeSourceUrlOrNull(source?.suggestedSourceUrl)
    ?? normalizeSourceUrlOrNull(DEFAULT_SOURCE_URLS[marketCode]);
  const exceptions = normalizeCalendarExceptions(request.calendarYear, request.exceptions);
  const annualCounts = computeAnnualCounts(request.calendarYear, exceptions);
  const active = await persistence.getActiveMarketCalendarVersion(marketCode, request.calendarYear);

  validateCalendarPreviewAgainstSource({
    marketCode,
    source,
    sourceType,
    sourceUrl,
    calendarYear: request.calendarYear,
    replaceConfirmed: request.replaceConfirmed,
    replacementReason: request.replacementReason,
    active,
    coverage: request.coverage,
    exceptions,
  });

  const diff = buildPreviewDiff(active, exceptions);
  const warnings = buildCalendarPreviewWarnings({
    request,
    source,
    sourceType,
    sourceUrl,
    active,
    annualCounts,
    exceptions,
  });

  const previewToken = randomUUID();
  const importOperationId = randomUUID();
  await persistence.saveMarketCalendarPreview({
    previewToken,
    importOperationId,
    marketCode,
    calendarYear: request.calendarYear,
    sourceId: request.sourceId ?? source?.id ?? null,
    sourceType,
    label,
    sourceUrl,
    retrievedAt: request.retrievedAt,
    coverage: {
      scope: "full_year",
      evidence: request.coverage.evidence.trim(),
      notes: request.coverage.notes?.trim() || null,
    },
    replaceConfirmedRequired: Boolean(active),
    warnings,
    diff,
    annualCounts,
    exceptions,
    createdAt: new Date().toISOString(),
  });

  return {
    marketCode,
    calendarYear: request.calendarYear,
    source: source ? { ...source, marketCode } : null,
    sourceType,
    sourceUrl,
    retrievedAt: request.retrievedAt,
    exceptionCount: exceptions.length,
    annualCounts,
    replaceConfirmedRequired: Boolean(active),
    warnings,
    diff,
    previewToken,
  };
}

export async function confirmAdminMarketCalendarImport(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  previewToken: string,
  replaceConfirmed?: boolean,
  replacementReason?: string | null,
): Promise<AdminMarketCalendarConfirmResponse> {
  const preview = await persistence.getMarketCalendarPreview(previewToken);
  if (!preview || preview.marketCode !== marketCode) {
    throw routeError(404, "market_calendar_preview_not_found", "Market calendar preview not found");
  }
  const active = await persistence.getActiveMarketCalendarVersion(marketCode, preview.calendarYear);
  const source = preview.sourceId
    ? (await persistence.listMarketCalendarSources(marketCode)).find((candidate) => candidate.id === preview.sourceId) ?? null
    : null;
  validateCalendarPreviewAgainstSource({
    marketCode,
    source,
    sourceType: preview.sourceType,
    sourceUrl: preview.sourceUrl,
    calendarYear: preview.calendarYear,
    replaceConfirmed,
    replacementReason,
    active,
    coverage: preview.coverage,
    exceptions: preview.exceptions,
  });
  const version = await persistence.confirmMarketCalendarPreview({ previewToken, replaceConfirmed, replacementReason });
  return {
    marketCode,
    calendarYear: version.calendarYear,
    versionId: version.versionId,
    activeVersionId: version.versionId,
    confirmedAt: version.confirmedAt ?? version.updatedAt,
  };
}

export async function buildAdminMarketCalendarHistory(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  calendarYear?: number,
): Promise<AdminMarketCalendarHistoryResponse> {
  const items = await persistence.listMarketCalendarHistory(marketCode, calendarYear);
  return {
    marketCode,
    items: items.map((item) => ({
      versionId: item.versionId,
      importOperationId: item.importOperationId,
      calendarYear: item.calendarYear,
      sourceLabel: item.sourceLabel,
      sourceType: item.sourceType,
      status: item.status,
      retrievedAt: item.retrievedAt,
      confirmedAt: item.confirmedAt,
      invalidatedAt: item.invalidatedAt,
      exceptionCount: item.exceptions.length,
      annualCounts: item.annualCounts,
      invalidationReason: item.invalidationReason,
    })),
  };
}

export async function updateAdminMarketCalendarSource(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  sourceId: string,
  input: MarketCalendarSourceUpdateInput,
) {
  const sources = await persistence.listMarketCalendarSources(marketCode);
  const existing = sources.find((candidate) => candidate.id === sourceId);
  if (!existing) {
    throw routeError(404, "market_calendar_source_not_found", "Market calendar source not found");
  }
  const next = normalizeMarketCalendarSourceConfig(marketCode, {
    ...existing,
    ...input,
    id: existing.id,
    marketCode,
  });
  const saved = await persistence.saveMarketCalendarSource({
    marketCode,
    sourceId: existing.id,
    label: next.label,
    sourceType: next.sourceType,
    suggestedSourceUrl: next.suggestedSourceUrl,
    enabled: next.enabled,
    isDefault: next.isDefault,
  });
  return { previous: existing, saved };
}

function normalizeCalendarExceptions(calendarYear: number, exceptions: AdminMarketCalendarPreviewRequest["exceptions"]): MarketCalendarExceptionInput[] {
  const deduped = new Map<string, MarketCalendarExceptionInput>();
  for (const raw of exceptions) {
    const date = raw.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw routeError(400, "market_calendar_invalid_date", `Calendar exception ${raw.date} must be an ISO date`);
    }
    if (!date.startsWith(`${calendarYear}-`)) {
      throw routeError(400, "calendar_exception_out_of_year", `Calendar exception ${date} is outside ${calendarYear}`);
    }
    if (deduped.has(date)) {
      throw routeError(400, "market_calendar_duplicate_exception", `Duplicate calendar exception for ${date}`);
    }
    const status = raw.status;
    const name = raw.name.trim();
    const evidence = raw.evidence.trim();
    const overrideReason = raw.overrideReason.trim();
    if (!name) throw routeError(400, "market_calendar_name_required", `Calendar exception ${date} requires name`);
    if (!evidence) throw routeError(400, "market_calendar_evidence_required", `Calendar exception ${date} requires evidence`);
    if (!overrideReason) throw routeError(400, "market_calendar_override_reason_required", `Calendar exception ${date} requires overrideReason`);
    const weekend = isWeekendIsoDate(date);
    if (status === "open" && !weekend) {
      throw routeError(400, "market_calendar_open_weekday_invalid", `Open weekday exception ${date} requires a weekend date`);
    }
    if (status === "closed" && weekend) {
      throw routeError(400, "market_calendar_closed_weekend_invalid", `Closed weekend exception ${date} is redundant`);
    }
    deduped.set(date, {
      date,
      status,
      name,
      evidence,
      overrideReason,
      notes: raw.notes?.trim() || null,
    });
  }
  return [...deduped.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function computeAnnualCounts(calendarYear: number, exceptions: ReadonlyArray<MarketCalendarExceptionInput>) {
  const exceptionMap = resolveCalendarExceptionMap(exceptions);
  let tradingDayCount = 0;
  let nonTradingDayCount = 0;
  let weekdayClosedCount = 0;
  let weekendOpenCount = 0;
  const current = new Date(`${calendarYear}-01-01T00:00:00.000Z`);
  while (current.getUTCFullYear() === calendarYear) {
    const date = current.toISOString().slice(0, 10);
    const exception = exceptionMap.get(date);
    const isOpen = exception ? exception.status === "open" : isWeekdayIsoDate(date);
    if (isOpen) tradingDayCount += 1;
    else nonTradingDayCount += 1;
    if (exception?.status === "closed") weekdayClosedCount += 1;
    if (exception?.status === "open") weekendOpenCount += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return {
    tradingDayCount,
    nonTradingDayCount,
    weekdayClosedCount,
    weekendOpenCount,
  };
}

function buildPreviewDiff(
  active: MarketCalendarVersionRecord | null,
  exceptions: ReadonlyArray<MarketCalendarExceptionInput>,
): AdminMarketCalendarPreviewResponse["diff"] {
  const nextMap = resolveCalendarExceptionMap(exceptions);
  const currentMap = resolveCalendarExceptionMap(active?.exceptions ?? []);
  return {
    addedExceptions: [...nextMap.keys()].filter((date) => !currentMap.has(date)).sort(),
    removedExceptions: [...currentMap.keys()].filter((date) => !nextMap.has(date)).sort(),
    changedExceptions: [...nextMap.keys()].filter((date) => {
      const next = nextMap.get(date);
      const current = currentMap.get(date);
      return current && JSON.stringify(next) !== JSON.stringify(current);
    }).sort(),
  };
}

function buildCalendarPreviewWarnings(input: {
  request: AdminMarketCalendarPreviewRequest;
  source: Awaited<ReturnType<Persistence["listMarketCalendarSources"]>>[number] | null;
  sourceType: "official_source" | "manual_ai_assisted";
  sourceUrl: string | null;
  active: MarketCalendarVersionRecord | null;
  annualCounts: AdminMarketCalendarPreviewResponse["annualCounts"];
  exceptions: ReadonlyArray<MarketCalendarExceptionInput>;
}): string[] {
  const warnings: string[] = [];
  if (input.exceptions.length <= LOW_EXCEPTION_WARNING_THRESHOLD) warnings.push("Unusually low exception count; confirm the full-year coverage evidence.");
  if (input.exceptions.length >= HIGH_EXCEPTION_WARNING_THRESHOLD) warnings.push("Unusually high exception count; confirm the normalized exceptions carefully.");
  if (input.annualCounts.weekendOpenCount > 0) warnings.push("Weekend-open exceptions are active for runtime and should be verified carefully.");
  if (input.sourceType === "manual_ai_assisted") warnings.push("Manual AI-assisted imports require operator review before activation.");
  if (!input.request.sourceUrl && input.sourceUrl) warnings.push("Source URL omitted; server applied the configured or default source URL.");
  if (input.active?.sourceType === "official_source" && input.sourceType === "manual_ai_assisted") {
    warnings.push("Manual AI-assisted import is replacing an official confirmed version.");
  }
  if (input.active && input.active.sourceType === input.sourceType) {
    warnings.push("A confirmed calendar already exists for this market-year and source type.");
  }
  for (const exception of input.exceptions) {
    if ((exception.status === "closed" && !isWeekdayIsoDate(exception.date)) || (exception.status === "open" && isWeekdayIsoDate(exception.date))) {
      warnings.push(`Redundant override detected for ${exception.date}.`);
    }
  }
  return [...new Set(warnings)];
}

async function resolveCalendarPreviewSource(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  sourceId?: string | null,
) {
  const sources = await persistence.listMarketCalendarSources(marketCode);
  if (sourceId) {
    const source = sources.find((candidate) => candidate.id === sourceId) ?? null;
    if (!source) throw routeError(404, "market_calendar_source_not_found", "Market calendar source not found");
    return source;
  }
  return sources.find((candidate) => candidate.isDefault && candidate.enabled) ?? null;
}

function validateCalendarPreviewAgainstSource(input: {
  marketCode: RegularSessionMarketCode;
  source: Awaited<ReturnType<Persistence["listMarketCalendarSources"]>>[number] | null;
  sourceType: "official_source" | "manual_ai_assisted";
  sourceUrl: string | null;
  calendarYear: number;
  replaceConfirmed?: boolean;
  replacementReason?: string | null;
  active: MarketCalendarVersionRecord | null;
  coverage: AdminMarketCalendarPreviewRequest["coverage"] | MarketCalendarVersionRecord["coverage"];
  exceptions: ReadonlyArray<MarketCalendarExceptionInput>;
}): void {
  if (input.source && !input.source.enabled) {
    throw routeError(400, "market_calendar_source_disabled", "Calendar preview source is disabled");
  }
  if (input.source && input.source.sourceType !== input.sourceType) {
    throw routeError(400, "market_calendar_source_type_mismatch", "Preview sourceType must match the configured source");
  }
  if (input.coverage.scope !== "full_year") {
    throw routeError(400, "market_calendar_coverage_scope_invalid", "Calendar coverage.scope must be full_year");
  }
  if (!input.coverage.evidence.trim()) {
    throw routeError(400, "market_calendar_coverage_evidence_required", "Calendar coverage requires evidence");
  }
  if (!input.sourceUrl) {
    throw routeError(400, "market_calendar_source_url_required", "Calendar source URL is required for provenance");
  }
  if (input.active) {
    const replacingOfficial = input.active.sourceType === "official_source" && input.sourceType === "manual_ai_assisted";
    const replacingSameSourceType = input.active.sourceType === input.sourceType;
    if ((replacingOfficial || replacingSameSourceType) && !input.replaceConfirmed) {
      throw routeError(400, "market_calendar_replace_required", "Replacing the confirmed calendar requires explicit confirmation");
    }
    if (replacingOfficial && !input.replacementReason?.trim()) {
      throw routeError(400, "market_calendar_replacement_reason_required", "Replacing an official confirmed calendar requires a replacement reason");
    }
  }
  for (const exception of input.exceptions) {
    if (exception.status === "open" && !isWeekendIsoDate(exception.date)) {
      throw routeError(400, "market_calendar_open_weekday_invalid", `Weekend-open exception ${exception.date} must fall on a weekend`);
    }
    if (exception.status === "closed" && isWeekendIsoDate(exception.date)) {
      throw routeError(400, "market_calendar_closed_weekend_invalid", `Closed weekend exception ${exception.date} is redundant`);
    }
  }
}

function normalizeMarketCalendarSourceConfig(
  marketCode: RegularSessionMarketCode,
  input: {
    id: string;
    marketCode: RegularSessionMarketCode;
    label: string;
    sourceType: "official_source" | "manual_ai_assisted";
    suggestedSourceUrl?: string | null;
    enabled?: boolean;
    isDefault?: boolean;
  },
) {
  return {
    id: input.id,
    marketCode,
    label: input.label.trim(),
    sourceType: input.sourceType,
    suggestedSourceUrl: normalizeSourceUrlOrNull(input.suggestedSourceUrl)
      ?? (input.sourceType === "official_source" ? DEFAULT_SOURCE_URLS[marketCode] : null),
    enabled: input.enabled ?? true,
    isDefault: input.isDefault ?? false,
  };
}

function normalizeSourceUrlOrNull(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") {
      throw routeError(400, "market_calendar_source_url_invalid", "Calendar source URL must use HTTPS");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) throw error;
    throw routeError(400, "market_calendar_source_url_invalid", "Calendar source URL must be a valid HTTPS URL");
  }
}
