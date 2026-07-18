"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type {
  DividendCalculationPreviewDto,
  DividendCalculationPreviewRequestDto,
  DividendCalculationVersionDto,
  DividendProviderValueDto,
  DividendStockCalculationMethod,
  LocaleCode,
  MarketCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import type { ReviewedDividendPostingCalculation } from "../types";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import {
  buildAccountDividendSettingsHref,
  amendDividendCalculation,
  confirmDividendCalculation,
  fetchAccountMarketDividendSettings,
  previewDividendCalculation,
  resetDividendCalculation,
} from "../services/dividendCalculationService";

interface DividendCalculationPanelProps {
  accountId: string;
  dividendEventId: string;
  marketCode: MarketCode;
  initialMethod: DividendStockCalculationMethod;
  canManageAccountDefaults: boolean;
  canWriteCalculations?: boolean;
  dividendLedgerEntryId?: string | null;
  onCalculationChanged?: () => Promise<void> | void;
  onReviewedCalculationChange?: (reviewed: ReviewedDividendPostingCalculation | null) => void;
  initialProvider?: DividendProviderValueDto | null;
  activeCalculation?: DividendCalculationVersionDto | null;
  calculationHistory?: DividendCalculationVersionDto[];
  dict: AppDictionary;
  locale: LocaleCode;
}

const METHODS: DividendStockCalculationMethod[] = [
  "provider_ratio",
  "derived_from_par_value",
  "custom_ratio",
];
const EMPTY_CALCULATION_HISTORY: DividendCalculationVersionDto[] = [];

function methodCopy(
  method: DividendStockCalculationMethod,
  dict: AppDictionary,
): { label: string; description: string } {
  switch (method) {
    case "provider_ratio":
      return {
        label: dict.dividends.form.calculation.providerRatio,
        description: dict.dividends.form.calculation.providerRatioDescription,
      };
    case "derived_from_par_value":
      return {
        label: dict.dividends.form.calculation.parValueMethod,
        description: dict.dividends.form.calculation.parValueMethodDescription,
      };
    case "custom_ratio":
      return {
        label: dict.dividends.form.calculation.customRatioMethod,
        description: dict.dividends.form.calculation.customRatioMethodDescription,
      };
  }
}

function displayValue(value: string | null, unavailable: string): string {
  return value?.trim() || unavailable;
}

function formatDecimal(value: string, locale: LocaleCode): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 10 }).format(numeric);
}

export function DividendCalculationPanel({
  accountId,
  dividendEventId,
  marketCode,
  initialMethod,
  canManageAccountDefaults,
  canWriteCalculations = true,
  dividendLedgerEntryId = null,
  onCalculationChanged,
  onReviewedCalculationChange,
  initialProvider,
  activeCalculation,
  calculationHistory = EMPTY_CALCULATION_HISTORY,
  dict,
  locale,
}: DividendCalculationPanelProps) {
  const parValueDirtyRef = useRef(false);
  const methodRef = useRef<DividendStockCalculationMethod>(initialMethod);
  const selectedParValueRef = useRef("");
  const mutationInFlightRef = useRef(false);
  const [method, setMethod] = useState<DividendStockCalculationMethod>(initialMethod);
  const [selectedParValue, setSelectedParValue] = useState("");
  const [customRatio, setCustomRatio] = useState("");
  const [preview, setPreview] = useState<DividendCalculationPreviewDto | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [activeCalculationState, setActiveCalculationState] = useState(activeCalculation ?? null);
  const [calculationHistoryState, setCalculationHistoryState] = useState<DividendCalculationVersionDto[]>(
    calculationHistory.length > 0 ? calculationHistory : activeCalculation ? [activeCalculation] : [],
  );
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [acknowledgeHighRatio, setAcknowledgeHighRatio] = useState(false);
  const [acknowledgeDrift, setAcknowledgeDrift] = useState(false);

  const refreshSettings = useCallback(async (silent = false) => {
    if (!silent) setIsSettingsLoading(true);
    try {
      const settings = await fetchAccountMarketDividendSettings(accountId, marketCode);
      if (!parValueDirtyRef.current) {
        const nextParValue = settings.fallbackParValue ?? "";
        if (silent && methodRef.current === "derived_from_par_value" && nextParValue !== selectedParValueRef.current) {
          setPreview(null);
          setPreviewError("");
          setAcknowledgeHighRatio(false);
          setAcknowledgeDrift(false);
        }
        selectedParValueRef.current = nextParValue;
        setSelectedParValue(nextParValue);
      }
      setSettingsError("");
    } catch {
      if (!silent) setSettingsError(dict.dividends.form.calculation.settingsError);
    } finally {
      if (!silent) setIsSettingsLoading(false);
    }
  }, [accountId, dict.dividends.form.calculation.settingsError, marketCode]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    const refreshOnFocus = () => void refreshSettings(true);
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") void refreshSettings(true);
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [refreshSettings]);

  useEffect(() => {
    setMethod(initialMethod);
    methodRef.current = initialMethod;
    setPreview(null);
    setPreviewError("");
    setMutationError("");
    setAcknowledgeHighRatio(false);
    setAcknowledgeDrift(false);
    parValueDirtyRef.current = false;
  }, [accountId, dividendEventId, initialMethod, marketCode]);

  useEffect(() => {
    setActiveCalculationState(activeCalculation ?? null);
    setCalculationHistoryState(calculationHistory.length > 0 ? calculationHistory : activeCalculation ? [activeCalculation] : []);
  }, [activeCalculation, calculationHistory]);

  function currentRequest(): DividendCalculationPreviewRequestDto {
    return {
      accountId,
      dividendEventId,
      method,
      ...(method === "derived_from_par_value" ? { selectedParValue: selectedParValue.trim() || null } : {}),
      ...(method === "custom_ratio" ? { customRatio: customRatio.trim() || null } : {}),
    };
  }

  async function handlePreview() {
    setIsPreviewing(true);
    setPreviewError("");
    try {
      const result = await previewDividendCalculation(currentRequest());
      setPreview(result);
      setAcknowledgeHighRatio(false);
      setAcknowledgeDrift(false);
    } catch {
      setPreview(null);
      setPreviewError(dict.dividends.form.calculation.previewError);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handlePersistCalculation() {
    if (!preview || !canWriteCalculations || mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setIsMutating(true);
    setMutationError("");
    try {
      const request = {
        ...currentRequest(),
        expectedActiveCalculationId: displayedCalculation?.id ?? null,
        expectedCalculationVersion: displayedCalculation?.calculationVersion ?? null,
        ...(preview.requiresHighRatioConfirmation ? { acknowledgeHighRatio } : {}),
        ...(preview.drift?.hasDrift ? { acknowledgeDrift } : {}),
      };
      const next = dividendLedgerEntryId
        ? await amendDividendCalculation({ ...request, dividendLedgerEntryId })
        : await confirmDividendCalculation(request);
      setActiveCalculationState(next);
      setCalculationHistoryState((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setPreview(null);
      await onCalculationChanged?.();
    } catch {
      setMutationError(dict.dividends.form.calculation.mutationError);
    } finally {
      mutationInFlightRef.current = false;
      setIsMutating(false);
    }
  }

  async function handleResetCalculation() {
    if (!canWriteCalculations || !displayedCalculation || mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setIsMutating(true);
    setMutationError("");
    try {
      await resetDividendCalculation({
        accountId,
        dividendEventId,
        expectedActiveCalculationId: displayedCalculation.id,
        expectedCalculationVersion: displayedCalculation.calculationVersion,
      });
      setActiveCalculationState(null);
      setPreview(null);
      await onCalculationChanged?.();
    } catch {
      setMutationError(dict.dividends.form.calculation.mutationError);
    } finally {
      mutationInFlightRef.current = false;
      setIsMutating(false);
    }
  }

  const canPreview = method === "provider_ratio"
    || (method === "derived_from_par_value" && selectedParValue.trim().length > 0)
    || (method === "custom_ratio" && customRatio.trim().length > 0);
  const copy = dict.dividends.form.calculation;
  const displayedCalculation = preview?.activeCalculation ?? activeCalculationState;
  const needsHighRatioAcknowledgement = Boolean(preview?.requiresHighRatioConfirmation);
  const needsDriftAcknowledgement = Boolean(preview?.drift?.hasDrift);
  const canPersistPreview = Boolean(preview)
    && (!needsHighRatioAcknowledgement || acknowledgeHighRatio)
    && (!needsDriftAcknowledgement || acknowledgeDrift);

  useEffect(() => {
    if (!preview || dividendLedgerEntryId) {
      onReviewedCalculationChange?.(null);
      return;
    }
    onReviewedCalculationChange?.({
      calculation: {
        method: preview.method,
        ...(preview.method === "derived_from_par_value" ? { selectedParValue: selectedParValue.trim() || null } : {}),
        ...(preview.method === "custom_ratio" ? { customRatio: customRatio.trim() || null } : {}),
        ...(needsHighRatioAcknowledgement ? { acknowledgeHighRatio } : {}),
        ...(needsDriftAcknowledgement ? { acknowledgeDrift } : {}),
      },
      canSubmit: canPersistPreview,
    });
  }, [
    acknowledgeDrift,
    acknowledgeHighRatio,
    canPersistPreview,
    customRatio,
    dividendLedgerEntryId,
    needsDriftAcknowledgement,
    needsHighRatioAcknowledgement,
    onReviewedCalculationChange,
    preview,
    selectedParValue,
  ]);

  return (
    <section
      className="space-y-4 rounded-[22px] border border-slate-200 bg-white/90 p-4"
      aria-labelledby={`dividend-calculation-title-${dividendEventId}`}
      data-testid="dividend-calculation-panel"
    >
      <div>
        <h4 id={`dividend-calculation-title-${dividendEventId}`} className="text-sm font-semibold text-slate-900">
          {copy.title}
        </h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">{copy.description}</p>
      </div>

      <fieldset disabled={!canWriteCalculations}>
        <legend className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {copy.methodsLabel}
        </legend>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {METHODS.map((candidate) => {
            const methodText = methodCopy(candidate, dict);
            const disabled = !canWriteCalculations || (candidate === "derived_from_par_value" && marketCode !== "TW");
            return (
              <label
                key={candidate}
                className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${method === candidate ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-slate-200 bg-slate-50/70"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  name={`dividend-calculation-method-${dividendEventId}`}
                  value={candidate}
                  checked={method === candidate}
                  disabled={disabled}
                  onChange={() => {
                    methodRef.current = candidate;
                    setMethod(candidate);
                    setPreview(null);
                    setPreviewError("");
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-900">{methodText.label}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-slate-500">{methodText.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {!preview ? (
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" data-testid="dividend-calculation-provider">
          <CalculationDetail label={copy.providerValue} value={displayValue(initialProvider?.value ?? null, copy.unavailable)} />
          <CalculationDetail label={copy.providerUnit} value={initialProvider?.unit ?? copy.unavailable} />
          <CalculationDetail label={copy.providerSource} value={displayValue(initialProvider?.source ?? null, copy.unavailable)} />
          <CalculationDetail label={copy.providerDataset} value={displayValue(initialProvider?.dataset ?? null, copy.unavailable)} />
          <CalculationDetail label={copy.providerAuthoritativeRatio} value={displayValue(initialProvider?.authoritativeRatio ?? null, copy.unavailable)} />
        </dl>
      ) : null}

      {calculationHistoryState.length > 0 ? (
        <section className="space-y-2" aria-labelledby={`dividend-calculation-history-title-${dividendEventId}`} data-testid="dividend-calculation-history">
          <h5 id={`dividend-calculation-history-title-${dividendEventId}`} className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{copy.historyTitle}</h5>
          <ol className="grid gap-2 lg:grid-cols-2">
            {calculationHistoryState.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3" data-testid={`dividend-calculation-history-version-${item.calculationVersion}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{copy.activeVersion} {item.calculationVersion}</p>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{item.status}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-slate-500">{copy.historyMethod}</dt><dd className="font-medium text-slate-900">{methodCopy(item.method, dict).label}</dd></div>
                  <div><dt className="text-slate-500">{copy.historyWholeShares}</dt><dd className="font-medium text-slate-900">{item.expectedWholeShares == null ? copy.unavailable : new Intl.NumberFormat(locale).format(item.expectedWholeShares)}</dd></div>
                  <div><dt className="text-slate-500">{copy.historyConfirmedAt}</dt><dd className="font-medium text-slate-900">{item.confirmedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.confirmedAt)) : copy.unavailable}</dd></div>
                  <div><dt className="text-slate-500">{copy.priorCalculation}</dt><dd className="break-all font-medium text-slate-900">{item.priorCalculationId ?? copy.unavailable}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {displayedCalculation && !preview ? (
        !canWriteCalculations ? (
          <p className="text-xs text-slate-500">{copy.readOnly}</p>
        ) : !dividendLedgerEntryId ? (
          <Button type="button" variant="secondary" onClick={() => void handleResetCalculation()} disabled={isMutating} data-testid="dividend-calculation-reset">
            {isMutating ? copy.saving : copy.reset}
          </Button>
        ) : null
      ) : null}

      {method === "derived_from_par_value" ? (
        <div className="space-y-2">
          <label htmlFor={`dividend-calculation-par-value-${dividendEventId}`} className="block text-xs font-medium text-slate-700">
            {copy.selectedParValue}
          </label>
          <div className="flex max-w-md items-center gap-2">
            <span className="text-sm font-medium text-slate-500">TWD</span>
            <input
              id={`dividend-calculation-par-value-${dividendEventId}`}
              value={selectedParValue}
              onChange={(event) => {
                parValueDirtyRef.current = true;
                selectedParValueRef.current = event.target.value;
                setSelectedParValue(event.target.value);
                setPreview(null);
              }}
              inputMode="decimal"
              disabled={!canWriteCalculations}
              className={fieldClassName}
              aria-busy={isSettingsLoading}
              data-testid="dividend-calculation-par-value"
            />
          </div>
        </div>
      ) : null}

      {method === "custom_ratio" ? (
        <div className="max-w-md space-y-2">
          <label htmlFor={`dividend-calculation-custom-ratio-${dividendEventId}`} className="block text-xs font-medium text-slate-700">
            {copy.customRatio}
          </label>
          <input
            id={`dividend-calculation-custom-ratio-${dividendEventId}`}
            value={customRatio}
            onChange={(event) => {
              setCustomRatio(event.target.value);
              setPreview(null);
            }}
            inputMode="decimal"
            disabled={!canWriteCalculations}
            className={fieldClassName}
            data-testid="dividend-calculation-custom-ratio"
          />
        </div>
      ) : null}

      {settingsError ? <p className="text-xs text-amber-700" role="status">{settingsError}</p> : null}
      {canManageAccountDefaults ? (
        <a
          href={buildAccountDividendSettingsHref(accountId, marketCode)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="dividend-calculation-settings-link"
        >
          {copy.settingsLink}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
      {previewError ? <p className="text-xs text-rose-700" role="alert">{previewError}</p> : null}

      {canWriteCalculations ? (
        <Button
          type="button"
          onClick={() => void handlePreview()}
          disabled={!canPreview || isPreviewing}
          aria-busy={isPreviewing}
          data-testid="dividend-calculation-preview"
        >
          {isPreviewing ? copy.previewing : copy.preview}
        </Button>
      ) : <p className="text-xs text-slate-500">{copy.readOnly}</p>}

      {preview ? (
        <div className="space-y-3" aria-live="polite" data-testid="dividend-calculation-result">
          <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <CalculationDetail label={copy.eligibleQuantity} value={new Intl.NumberFormat(locale).format(preview.eligibleQuantity)} />
            <CalculationDetail label={copy.providerValue} value={displayValue(preview.providerValue, copy.unavailable)} />
            <CalculationDetail label={copy.providerUnit} value={preview.providerUnit ?? copy.unavailable} />
            <CalculationDetail label={copy.providerSource} value={displayValue(preview.providerSource, copy.unavailable)} />
            <CalculationDetail label={copy.providerDataset} value={displayValue(preview.providerDataset, copy.unavailable)} />
            <CalculationDetail label={copy.providerAuthoritativeRatio} value={displayValue(preview.providerAuthoritativeRatio, copy.unavailable)} />
            <CalculationDetail label={copy.selectedMethod} value={methodCopy(preview.method, dict).label} />
            <CalculationDetail label={copy.ratio} value={formatDecimal(preview.ratio, locale)} />
            <CalculationDetail label={copy.theoreticalShares} value={formatDecimal(preview.theoreticalShares, locale)} />
            <CalculationDetail label={copy.expectedWholeShares} value={new Intl.NumberFormat(locale).format(preview.expectedWholeShares)} emphasized />
            <CalculationDetail label={copy.fractionalRemainder} value={formatDecimal(preview.fractionalRemainder, locale)} />
          </dl>
          {preview.requiresHighRatioConfirmation ? (
            <p
              className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs font-medium leading-5 text-amber-900"
              role="alert"
              data-testid="dividend-calculation-high-ratio-warning"
            >
              {copy.highRatioWarning}
            </p>
          ) : null}
          {preview.drift?.hasDrift ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950" role="alert" data-testid="dividend-calculation-drift">
              <p className="text-xs font-semibold">{copy.driftTitle}</p>
              <p className="mt-1 text-xs leading-5">{copy.driftDescription}</p>
              <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <CalculationDetail label={copy.previousProvider} value={displayValue(preview.drift.previousProviderValue, copy.unavailable)} />
                <CalculationDetail label={copy.currentProvider} value={displayValue(preview.drift.currentProviderValue, copy.unavailable)} />
                <CalculationDetail label={copy.previousRatio} value={displayValue(preview.drift.previousAuthoritativeRatio, copy.unavailable)} />
                <CalculationDetail label={copy.currentRatio} value={displayValue(preview.drift.currentAuthoritativeRatio, copy.unavailable)} />
              </dl>
            </div>
          ) : null}
          {canWriteCalculations ? (
            <div className="space-y-3 border-t border-slate-200 pt-3">
              {needsHighRatioAcknowledgement ? (
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={acknowledgeHighRatio} onChange={(event) => setAcknowledgeHighRatio(event.target.checked)} className="mt-0.5" data-testid="dividend-calculation-ack-high-ratio" />
                  <span>{copy.acknowledgeHighRatio}</span>
                </label>
              ) : null}
              {needsDriftAcknowledgement ? (
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={acknowledgeDrift} onChange={(event) => setAcknowledgeDrift(event.target.checked)} className="mt-0.5" data-testid="dividend-calculation-ack-drift" />
                  <span>{copy.acknowledgeDrift}</span>
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void handlePersistCalculation()} disabled={!canPersistPreview || isMutating} aria-busy={isMutating} data-testid="dividend-calculation-confirm">
                  {isMutating ? copy.saving : dividendLedgerEntryId ? copy.amend : copy.confirm}
                </Button>
                {displayedCalculation && !dividendLedgerEntryId ? (
                  <Button type="button" variant="secondary" onClick={() => void handleResetCalculation()} disabled={isMutating} data-testid="dividend-calculation-reset">
                    {copy.reset}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : <p className="text-xs text-slate-500">{copy.readOnly}</p>}
        </div>
      ) : null}
      {mutationError ? <p className="text-xs text-rose-700" role="alert">{mutationError}</p> : null}
    </section>
  );
}

function CalculationDetail({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-slate-900 ${emphasized ? "font-bold" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
