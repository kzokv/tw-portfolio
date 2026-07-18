"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountMarketDividendSettingsDto, MarketCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import {
  fetchAccountMarketDividendSettings,
  patchAccountMarketDividendSettings,
} from "../../dividends/services/dividendCalculationService";

interface AccountDividendSettingsSectionProps {
  accountId: string;
  marketCode: MarketCode;
  canManage: boolean;
  dict: AppDictionary;
  focused?: boolean;
}

function replace(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function exampleCopy(parValue: string, dict: AppDictionary): string {
  const numericParValue = Number(parValue);
  const ratio = 0.25 / numericParValue;
  const shares = ratio * 1_000;
  return replace(dict.settings.dividendSettingsExample, {
    parValue,
    ratio: ratio.toLocaleString("en-US", { maximumFractionDigits: 8 }),
    shares: shares.toLocaleString("en-US", { maximumFractionDigits: 4 }),
  });
}

export function AccountDividendSettingsSection({
  accountId,
  marketCode,
  canManage,
  dict,
  focused = false,
}: AccountDividendSettingsSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [settings, setSettings] = useState<AccountMarketDividendSettingsDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const next = await fetchAccountMarketDividendSettings(accountId, marketCode);
      setSettings(next);
      if (!isEditingRef.current) setDraft(next.fallbackParValue ?? "");
      setError("");
    } catch {
      if (!silent) setError(dict.settings.dividendSettingsLoadError);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [accountId, dict.settings.dividendSettingsLoadError, marketCode]);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshOnFocus = () => void refresh(true);
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!focused) return;
    sectionRef.current?.scrollIntoView?.({ block: "center" });
    sectionRef.current?.focus({ preventScroll: true });
  }, [focused]);

  async function save(fallbackParValue: string | null) {
    if (!settings) return;
    if (fallbackParValue !== null) {
      const numeric = Number(fallbackParValue);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        setError(dict.settings.dividendSettingsInvalid);
        return;
      }
    }
    setIsSaving(true);
    setError("");
    try {
      const next = await patchAccountMarketDividendSettings(accountId, marketCode, {
        expectedVersion: settings.version,
        fallbackParValue,
      });
      setSettings(next);
      setDraft(next.fallbackParValue ?? "");
      setIsEditing(false);
    } catch {
      setError(dict.settings.dividendSettingsSaveError);
    } finally {
      setIsSaving(false);
    }
  }

  const supported = marketCode === "TW";
  const value = settings?.fallbackParValue;

  return (
    <section
      ref={sectionRef}
      id={`dividend-calculation-defaults-${accountId}-${marketCode}`}
      tabIndex={-1}
      aria-labelledby={`dividend-calculation-defaults-title-${accountId}-${marketCode}`}
      className={`rounded-lg border px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-primary ${focused ? "border-primary/40 bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]" : "border-border bg-muted/20"}`}
      data-testid={`dividend-settings-section-${accountId}-${marketCode}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4
              id={`dividend-calculation-defaults-title-${accountId}-${marketCode}`}
              className="text-sm font-semibold text-foreground"
            >
              {dict.settings.dividendSettingsTitle}
            </h4>
            {focused ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {dict.settings.dividendSettingsFocused}
              </span>
            ) : null}
          </div>
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            {dict.settings.dividendSettingsDescription}
          </p>
        </div>
        {supported && canManage && settings && !isEditing ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(value ?? "");
              setError("");
              setIsEditing(true);
            }}
            data-testid={`dividend-settings-edit-${accountId}-${marketCode}`}
          >
            {dict.settings.dividendSettingsEdit}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
          {dict.feedback.loadingSettings}
        </p>
      ) : !supported ? (
        <p className="mt-4 rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          {dict.settings.dividendSettingsUnavailableMarket}
        </p>
      ) : settings ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {dict.settings.dividendSettingsMarketLabel}
            </p>
            <p className="font-mono text-sm font-semibold text-foreground">{marketCode}</p>
            <label
              htmlFor={`dividend-settings-par-value-${accountId}-${marketCode}`}
              className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {dict.settings.dividendSettingsFallbackLabel}
            </label>
            {isEditing ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">TWD</span>
                  <input
                    id={`dividend-settings-par-value-${accountId}-${marketCode}`}
                    inputMode="decimal"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    className={fieldClassName}
                    disabled={isSaving}
                    aria-invalid={Boolean(error)}
                    data-testid={`dividend-settings-par-value-${accountId}-${marketCode}`}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void save(draft.trim() || null)}
                    disabled={isSaving}
                    aria-busy={isSaving}
                    data-testid={`dividend-settings-save-${accountId}-${marketCode}`}
                  >
                    {dict.settings.dividendSettingsSave}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraft(value ?? "");
                      setError("");
                      setIsEditing(false);
                    }}
                    disabled={isSaving}
                  >
                    {dict.settings.dividendSettingsCancel}
                  </Button>
                  {value !== null ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void save(null)}
                      disabled={isSaving}
                      data-testid={`dividend-settings-clear-${accountId}-${marketCode}`}
                    >
                      {dict.settings.dividendSettingsClear}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm font-semibold text-foreground">
              {value == null ? dict.settings.dividendSettingsUnset : `TWD ${value}`}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {dict.settings.dividendSettingsExampleLabel}
            </p>
            <p className="rounded-md border border-border bg-card px-3 py-3 text-xs leading-5 text-foreground">
              {value == null ? dict.settings.dividendSettingsHint : exampleCopy(value, dict)}
            </p>
            {!canManage ? <p className="text-xs text-muted-foreground">{dict.settings.dividendSettingsReadOnly}</p> : null}
            {settings.updatedAt ? (
              <p className="text-[10px] text-muted-foreground">
                {replace(dict.settings.dividendSettingsUpdated, {
                  date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(settings.updatedAt)),
                })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
