import {
  ACCOUNT_DEFAULT_CURRENCIES,
  REPORT_CURRENCY_MODES,
  REPORT_SCOPES,
  currencyFor,
  type AccountDefaultCurrency,
  type ReportCurrencyMode,
  type ReportScope,
} from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";

export interface ResolveReportContextInput {
  scope?: string;
  currencyMode?: string;
  currency?: string;
  defaultReportingCurrency: AccountDefaultCurrency;
}

export interface ReportContextResolution {
  scope: ReportScope;
  currencyMode: ReportCurrencyMode;
  currency: AccountDefaultCurrency | null;
  reportingCurrency: AccountDefaultCurrency;
  nativeCurrency: AccountDefaultCurrency | null;
}

export function resolveReportContext(input: ResolveReportContextInput): ReportContextResolution {
  const scope = (input.scope ?? "all").trim();
  if (!(REPORT_SCOPES as readonly string[]).includes(scope)) {
    throw routeError(400, "invalid_report_scope", "scope must be all, TW, US, AU, or KR");
  }

  const currencyMode = (input.currencyMode ?? "auto").trim();
  if (!(REPORT_CURRENCY_MODES as readonly string[]).includes(currencyMode)) {
    throw routeError(400, "invalid_report_currency_mode", "currencyMode must be auto or specified");
  }

  const resolvedScope = scope as ReportScope;
  const resolvedMode = currencyMode as ReportCurrencyMode;
  const normalizedCurrency = input.currency?.trim().toUpperCase() ?? null;
  if (normalizedCurrency !== null && !(ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(normalizedCurrency)) {
    throw routeError(400, "invalid_report_currency", "currency must be TWD, USD, AUD, or KRW");
  }

  const nativeCurrency = resolvedScope === "all" ? null : currencyFor(resolvedScope);
  if (resolvedMode === "auto") {
    return {
      scope: resolvedScope,
      currencyMode: resolvedMode,
      currency: null,
      reportingCurrency: nativeCurrency ?? input.defaultReportingCurrency,
      nativeCurrency,
    };
  }

  if (normalizedCurrency === null) {
    throw routeError(400, "invalid_report_currency", "currency is required when currencyMode=specified");
  }

  return {
    scope: resolvedScope,
    currencyMode: resolvedMode,
    currency: normalizedCurrency as AccountDefaultCurrency,
    reportingCurrency: normalizedCurrency as AccountDefaultCurrency,
    nativeCurrency,
  };
}
