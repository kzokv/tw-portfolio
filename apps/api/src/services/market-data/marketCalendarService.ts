import { randomUUID } from "node:crypto";
import type {
  AdminMarketCalendarConfirmResponse,
  AdminMarketCalendarHistoryResponse,
  AdminMarketCalendarImportRowDto,
  AdminMarketCalendarPreviewRequest,
  AdminMarketCalendarPreviewResponse,
  AdminMarketCalendarStatusResponse,
} from "@vakwen/shared-types";
import type { MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";
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

const CALENDAR_SOURCE_RULES: Record<RegularSessionMarketCode, {
  parserIds: readonly string[];
  allowedHosts: readonly string[];
}> = {
  TW: {
    parserIds: ["tw-official"],
    allowedHosts: ["twse.com.tw", "www.twse.com.tw"],
  },
  US: {
    parserIds: ["us-official"],
    allowedHosts: ["nasdaqtrader.com", "www.nasdaqtrader.com", "nyse.com", "www.nyse.com"],
  },
  AU: {
    parserIds: ["au-official"],
    allowedHosts: ["asx.com.au", "www.asx.com.au"],
  },
  KR: {
    parserIds: ["kr-official"],
    allowedHosts: ["krx.co.kr", "global.krx.co.kr", "kind.krx.co.kr"],
  },
};

type MarketCalendarSourceUpdateInput = {
  label?: string;
  sourceType?: "official_parser" | "manual_ai_assisted";
  url?: string | null;
  host?: string | null;
  allowedHosts?: string[];
  parserId?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
};

export function isOfficialCalendarMarketCode(marketCode: MarketCode): marketCode is RegularSessionMarketCode {
  return SUPPORTED_MARKETS.has(marketCode as RegularSessionMarketCode);
}

export async function getOfficialCalendarDayStatus(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  at: Date,
): Promise<OfficialCalendarDayStatus> {
  const { localDate } = getMarketLocalParts(marketCode, at);
  const calendarYear = Number(localDate.slice(0, 4));
  const version = await persistence.getActiveMarketCalendarVersion(marketCode, calendarYear);
  if (!version) {
    return { marketCode, localDate, calendarYear, status: "calendar_unknown", reason: "calendar_unknown" };
  }
  const row = version.rows.find((candidate) => candidate.date === localDate);
  if (!row) {
    return { marketCode, localDate, calendarYear, status: "calendar_unknown", reason: "calendar_unknown" };
  }
  return {
    marketCode,
    localDate,
    calendarYear,
    status: row.isOpen ? "open" : "closed",
    reason: row.isOpen ? "not_trading_day" : "not_trading_day",
  };
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
      openDayCount: active.rows.filter((row) => row.isOpen).length,
      closedDayCount: active.rows.filter((row) => !row.isOpen).length,
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
  const normalizedRows = normalizeCalendarRows(request.calendarYear, request.rows);
  const active = await persistence.getActiveMarketCalendarVersion(marketCode, request.calendarYear);
  const source = await resolveCalendarPreviewSource(persistence, marketCode, request.sourceId);
  const sourceType = request.sourceType ?? source?.sourceType ?? "manual_ai_assisted";
  const label = request.label ?? source?.label ?? null;
  validateCalendarPreviewAgainstSource({
    marketCode,
    source,
    sourceType,
    calendarYear: request.calendarYear,
    replaceConfirmed: request.replaceConfirmed,
    replacementReason: request.replacementReason,
    active,
  });
  const nextOpenDates = new Set(normalizedRows.filter((row) => row.isOpen).map((row) => row.date));
  const currentOpenDates = new Set(active?.rows.filter((row) => row.isOpen).map((row) => row.date) ?? []);
  const diff = {
    addedDates: [...nextOpenDates].filter((date) => !currentOpenDates.has(date)).sort(),
    removedDates: [...currentOpenDates].filter((date) => !nextOpenDates.has(date)).sort(),
    changedDates: normalizedRows
      .filter((row) => active?.rows.some((existing) => existing.date === row.date && existing.isOpen !== row.isOpen))
      .map((row) => row.date)
      .sort(),
  };
  const previewToken = randomUUID();
  const importOperationId = randomUUID();
  const warnings = buildCalendarPreviewWarnings(active, normalizedRows, request);
  await persistence.saveMarketCalendarPreview({
    previewToken,
    importOperationId,
    marketCode,
    calendarYear: request.calendarYear,
    sourceId: request.sourceId ?? source?.id ?? null,
    sourceType,
    label,
    retrievedAt: request.retrievedAt,
    replaceConfirmedRequired: Boolean(active),
    warnings,
    diff,
    rows: normalizedRows,
    createdAt: new Date().toISOString(),
  });
  return {
    marketCode,
    calendarYear: request.calendarYear,
    source: source ? { ...source, marketCode } : null,
    sourceType,
    retrievedAt: request.retrievedAt,
    rowCount: normalizedRows.length,
    openDayCount: normalizedRows.filter((row) => row.isOpen).length,
    closedDayCount: normalizedRows.filter((row) => !row.isOpen).length,
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
  validateCalendarPreviewAgainstSource({
    marketCode,
    source: preview.sourceId
      ? (await persistence.listMarketCalendarSources(marketCode)).find((candidate) => candidate.id === preview.sourceId) ?? null
      : null,
    sourceType: preview.sourceType,
    calendarYear: preview.calendarYear,
    replaceConfirmed,
    replacementReason,
    active,
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
      rowCount: item.rows.length,
      openDayCount: item.rows.filter((row) => row.isOpen).length,
      closedDayCount: item.rows.filter((row) => !row.isOpen).length,
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
    url: next.url,
    host: next.host,
    allowedHosts: next.allowedHosts,
    parserId: next.parserId,
    enabled: next.enabled,
    isDefault: next.isDefault,
  });
  return { previous: existing, saved };
}

function normalizeCalendarRows(calendarYear: number, rows: AdminMarketCalendarImportRowDto[]) {
  const deduped = new Map<string, AdminMarketCalendarImportRowDto>();
  for (const row of rows) {
    if (!row.date.startsWith(`${calendarYear}-`)) {
      throw routeError(400, "calendar_row_out_of_year", `Calendar row ${row.date} is outside ${calendarYear}`);
    }
    if (deduped.has(row.date)) {
      throw routeError(400, "market_calendar_duplicate_date", `Duplicate calendar row for ${row.date}`);
    }
    deduped.set(row.date, row);
  }
  const missingDates = listMissingCalendarDates(calendarYear, new Set(deduped.keys()));
  if (missingDates.length > 0) {
    throw routeError(400, "market_calendar_full_year_required", "Calendar payload must cover every date in the target year", {
      calendarYear,
      missingDateCount: missingDates.length,
      sampleMissingDates: missingDates.slice(0, 5),
    });
  }
  return [...deduped.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => ({ date: row.date, isOpen: row.isOpen, evidence: row.evidence, notes: row.notes ?? null }));
}

function buildCalendarPreviewWarnings(
  active: Awaited<ReturnType<Persistence["getActiveMarketCalendarVersion"]>>,
  rows: ReturnType<typeof normalizeCalendarRows>,
  request: AdminMarketCalendarPreviewRequest,
): string[] {
  const warnings: string[] = [];
  if (rows.length < 200) warnings.push("Calendar preview has fewer than 200 rows.");
  if (active && !request.replaceConfirmed) warnings.push("A confirmed calendar already exists for this market-year.");
  if (request.sourceType === "manual_ai_assisted") warnings.push("Manual AI-assisted imports require operator review before activation.");
  return warnings;
}

function listMissingCalendarDates(calendarYear: number, seenDates: ReadonlySet<string>): string[] {
  const dates: string[] = [];
  const current = new Date(`${calendarYear}-01-01T00:00:00.000Z`);
  while (current.getUTCFullYear() === calendarYear) {
    const date = current.toISOString().slice(0, 10);
    if (!seenDates.has(date)) dates.push(date);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function resolveCalendarPreviewSource(
  persistence: Persistence,
  marketCode: RegularSessionMarketCode,
  sourceId?: string | null,
) {
  const sources = await persistence.listMarketCalendarSources(marketCode);
  if (sourceId) {
    const source = sources.find((candidate) => candidate.id === sourceId) ?? null;
    if (!source) {
      throw routeError(404, "market_calendar_source_not_found", "Market calendar source not found");
    }
    return source;
  }
  return sources.find((candidate) => candidate.isDefault && candidate.enabled) ?? null;
}

function validateCalendarPreviewAgainstSource(input: {
  marketCode: RegularSessionMarketCode;
  source: Awaited<ReturnType<Persistence["listMarketCalendarSources"]>>[number] | null;
  sourceType: "official_parser" | "manual_ai_assisted";
  calendarYear: number;
  replaceConfirmed?: boolean;
  replacementReason?: string | null;
  active: Awaited<ReturnType<Persistence["getActiveMarketCalendarVersion"]>>;
}): void {
  if (input.source && !input.source.enabled) {
    throw routeError(400, "market_calendar_source_disabled", "Calendar preview source is disabled");
  }
  if (input.source && input.source.sourceType !== input.sourceType) {
    throw routeError(400, "market_calendar_source_type_mismatch", "Preview sourceType must match the configured source");
  }
  if (
    input.active?.sourceType === "official_parser"
    && input.sourceType === "manual_ai_assisted"
    && input.replaceConfirmed
    && !input.replacementReason?.trim()
  ) {
    throw routeError(400, "market_calendar_replacement_reason_required", "Replacing an official confirmed calendar requires a replacement reason");
  }
}

function normalizeMarketCalendarSourceConfig(
  marketCode: RegularSessionMarketCode,
  input: {
    id: string;
    marketCode: RegularSessionMarketCode;
    label: string;
    sourceType: "official_parser" | "manual_ai_assisted";
    url?: string | null;
    host?: string | null;
    allowedHosts?: string[];
    parserId?: string | null;
    enabled?: boolean;
    isDefault?: boolean;
  },
) {
  const rules = CALENDAR_SOURCE_RULES[marketCode];
  const urlHost = input.url ? new URL(input.url).hostname.toLowerCase() : null;
  const explicitHost = input.host?.trim().toLowerCase() || null;
  if (urlHost && explicitHost && urlHost !== explicitHost) {
    throw routeError(400, "market_calendar_source_host_mismatch", "Configured host must match the source URL host");
  }
  const host = urlHost ?? explicitHost;
  const allowedHosts = dedupeStrings(
    (input.allowedHosts ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  if (input.sourceType === "official_parser") {
    if (!input.parserId || !rules.parserIds.includes(input.parserId)) {
      throw routeError(400, "market_calendar_parser_incompatible", `Parser ${input.parserId ?? "(missing)"} is not allowed for ${marketCode}`);
    }
    if (host && !rules.allowedHosts.includes(host)) {
      throw routeError(400, "market_calendar_host_not_allowlisted", `Host ${host} is not allowlisted for ${marketCode}`);
    }
    for (const allowedHost of allowedHosts) {
      if (!rules.allowedHosts.includes(allowedHost)) {
        throw routeError(400, "market_calendar_host_not_allowlisted", `Host ${allowedHost} is not allowlisted for ${marketCode}`);
      }
    }
  } else {
    if (input.parserId) {
      throw routeError(400, "market_calendar_parser_not_supported", "Manual AI-assisted calendar sources cannot set parserId");
    }
    if (host || allowedHosts.length > 0 || input.url) {
      throw routeError(400, "market_calendar_manual_source_remote_not_supported", "Manual AI-assisted calendar sources cannot configure remote host or URL in this slice");
    }
  }

  return {
    id: input.id,
    marketCode,
    label: input.label.trim(),
    sourceType: input.sourceType,
    url: input.sourceType === "official_parser" ? input.url ?? null : null,
    host: input.sourceType === "official_parser" ? host : null,
    allowedHosts: input.sourceType === "official_parser" ? allowedHosts : [],
    parserId: input.sourceType === "official_parser" ? input.parserId ?? null : null,
    enabled: input.enabled ?? true,
    isDefault: input.isDefault ?? false,
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
