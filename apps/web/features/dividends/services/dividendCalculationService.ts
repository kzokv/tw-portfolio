import type {
  AccountMarketDividendSettingsDto,
  AccountMarketDividendSettingsPatchDto,
  DividendCalculationAmendRequestDto,
  DividendCalculationConfirmRequestDto,
  DividendCalculationPreviewDto,
  DividendCalculationPreviewRequestDto,
  DividendCalculationResetRequestDto,
  DividendCalculationVersionDto,
  MarketCode,
} from "@vakwen/shared-types";
import { MARKET_CODES } from "@vakwen/shared-types";
import { getJson, patchJson, postJson } from "../../../lib/api";

const DIVIDEND_SETTINGS_SECTION = "dividend-calculation-defaults";

function calculationIdempotencyKey(operation: "confirm" | "reset" | "amend"): string {
  const nonce = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `dividend-calculation-${operation}-${nonce}`;
}

function accountMarketSettingsPath(accountId: string, marketCode: MarketCode): string {
  return `/accounts/${encodeURIComponent(accountId)}/dividend-settings/${encodeURIComponent(marketCode)}`;
}

export function fetchAccountMarketDividendSettings(
  accountId: string,
  marketCode: MarketCode,
): Promise<AccountMarketDividendSettingsDto> {
  return getJson<AccountMarketDividendSettingsDto>(
    accountMarketSettingsPath(accountId, marketCode),
  );
}

export function patchAccountMarketDividendSettings(
  accountId: string,
  marketCode: MarketCode,
  patch: AccountMarketDividendSettingsPatchDto,
): Promise<AccountMarketDividendSettingsDto> {
  return patchJson<AccountMarketDividendSettingsDto>(
    accountMarketSettingsPath(accountId, marketCode),
    patch,
  );
}

export function previewDividendCalculation(
  request: DividendCalculationPreviewRequestDto,
): Promise<DividendCalculationPreviewDto> {
  return postJson<DividendCalculationPreviewDto>(
    "/portfolio/dividends/calculations/preview",
    request,
  );
}

export function confirmDividendCalculation(
  request: DividendCalculationConfirmRequestDto,
): Promise<DividendCalculationVersionDto> {
  return postJson<DividendCalculationVersionDto>(
    "/portfolio/dividends/calculations/confirm",
    request,
    { "idempotency-key": calculationIdempotencyKey("confirm") },
  );
}

export function resetDividendCalculation(
  request: DividendCalculationResetRequestDto,
): Promise<{ status: "ok" }> {
  return postJson<{ status: "ok" }>(
    "/portfolio/dividends/calculations/reset",
    request,
    { "idempotency-key": calculationIdempotencyKey("reset") },
  );
}

export function amendDividendCalculation(
  request: DividendCalculationAmendRequestDto,
): Promise<DividendCalculationVersionDto> {
  return postJson<DividendCalculationVersionDto>(
    "/portfolio/dividends/calculations/amend",
    request,
    { "idempotency-key": calculationIdempotencyKey("amend") },
  );
}

export function buildAccountDividendSettingsHref(
  accountId: string,
  marketCode: MarketCode,
): string {
  const query = new URLSearchParams({
    accountId,
    marketCode,
    section: DIVIDEND_SETTINGS_SECTION,
  });
  return `/settings/accounts?${query.toString()}`;
}

export function isDividendSettingsSection(value: string | null): boolean {
  return value === DIVIDEND_SETTINGS_SECTION;
}

interface SearchParamsReader {
  get(name: string): string | null;
}

export function parseAccountDividendSettingsFocus(
  searchParams: SearchParamsReader,
): { accountId: string; marketCode: MarketCode } | null {
  if (!isDividendSettingsSection(searchParams.get("section"))) return null;
  const accountId = searchParams.get("accountId")?.trim();
  const marketCode = searchParams.get("marketCode")?.trim();
  if (!accountId || !marketCode || !MARKET_CODES.some((candidate) => candidate === marketCode)) {
    return null;
  }
  return { accountId, marketCode: marketCode as MarketCode };
}
