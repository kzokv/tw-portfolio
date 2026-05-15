"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  AdminInstrumentDto,
  AdminInstrumentStatus,
  AdminInstrumentsResponse,
} from "@vakwen/shared-types";
import { ApiError, getJson, postJson } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Pagination } from "./Pagination";
import { cn } from "../../lib/utils";

// i18n strings — string templates only, no function values
// (per .claude/rules/nextjs-i18n-serialization.md)
const t = {
  pageTitle: "Instruments",
  pageDescription:
    "Review AU catalog instruments and absence-based delisting state. Use the actions to recover false positives or exclude rows from automated detection.",
  thresholdsTitle: "Detection thresholds",
  thresholdsDescription:
    "Read-only — adjust in {settingsLink}. Higher thresholds reduce false positives at the cost of slower delisting confirmation.",
  thresholdAbsenceLabel: "Absence streak threshold",
  thresholdAbsenceUnit: "consecutive runs",
  thresholdGuardPercentLabel: "Mass-delisting guard (% of catalog)",
  thresholdGuardFloorLabel: "Mass-delisting guard floor",
  thresholdGuardFloorUnit: "absent rows",
  settingsLinkLabel: "/admin/settings",
  tickerLabel: "Ticker",
  nameLabel: "Name",
  marketLabel: "Market",
  statusLabel: "Status",
  absenceStreakLabel: "Absence streak",
  lastSeenLabel: "Last seen in catalog",
  delistedAtLabel: "Delisted at",
  statusReasonLabel: "Status reason",
  actionsLabel: "Actions",
  statusListed: "Listed",
  statusDelisted: "Delisted",
  statusExcluded: "Excluded from detection",
  undeleteButtonLabel: "Undelete",
  excludeButtonLabel: "Exclude from detection",
  includeButtonLabel: "Include in detection",
  emptyLabel: "No instruments to show.",
  loadingLabel: "Loading instruments...",
  errorRetryLabel: "Retry",
  loadFailedLabel: "Failed to load instruments",
  undeleteConfirmLabel: "Undelete {ticker}?",
  excludeConfirmLabel: "Exclude {ticker} from absence detection?",
  includeConfirmLabel: "Re-enable absence detection for {ticker}?",
  workingLabel: "Working…",
  notListedLabel: "—",
};

function formatTimestamp(ts: string | null): string {
  if (!ts) return t.notListedLabel;
  return new Date(ts).toLocaleString();
}

function StatusBadge({
  status,
  ticker,
  testIdPrefix = "instrument-status-badge",
}: {
  status: AdminInstrumentStatus;
  ticker: string;
  testIdPrefix?: string;
}) {
  const label =
    status === "listed"
      ? t.statusListed
      : status === "delisted"
        ? t.statusDelisted
        : t.statusExcluded;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        status === "listed" && "bg-emerald-100 text-emerald-800",
        status === "delisted" && "bg-rose-100 text-rose-800",
        status === "excluded" && "bg-slate-200 text-slate-700",
      )}
      data-testid={`${testIdPrefix}-${ticker}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "listed" && "bg-emerald-500",
          status === "delisted" && "bg-rose-500",
          status === "excluded" && "bg-slate-500",
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

interface RowActionsState {
  busyTicker: string | null;
  error: string | null;
}

interface InstrumentActionsProps {
  instrument: AdminInstrumentDto;
  busy: boolean;
  onUndelete: (instrument: AdminInstrumentDto) => void;
  onToggleExclusion: (instrument: AdminInstrumentDto) => void;
  testIdSuffix?: string;
}

function InstrumentActions({
  instrument,
  busy,
  onUndelete,
  onToggleExclusion,
  testIdSuffix = "",
}: InstrumentActionsProps) {
  const ticker = instrument.ticker;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {instrument.status === "delisted" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onUndelete(instrument)}
          data-testid={`instrument-undelete-btn${testIdSuffix}-${ticker}`}
        >
          {busy ? t.workingLabel : t.undeleteButtonLabel}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onToggleExclusion(instrument)}
        data-testid={`instrument-exclude-toggle-btn${testIdSuffix}-${ticker}`}
      >
        {busy
          ? t.workingLabel
          : instrument.delistingDetectionExcluded
            ? t.includeButtonLabel
            : t.excludeButtonLabel}
      </Button>
    </div>
  );
}

function InstrumentRow({
  instrument,
  busy,
  onUndelete,
  onToggleExclusion,
}: {
  instrument: AdminInstrumentDto;
  busy: boolean;
  onUndelete: (instrument: AdminInstrumentDto) => void;
  onToggleExclusion: (instrument: AdminInstrumentDto) => void;
}) {
  return (
    <tr
      className="border-b border-slate-200 last:border-0"
      data-testid={`instrument-row-${instrument.ticker}`}
    >
      {/* KZO-199 — opaque ID columns (ticker, marketCode, timestamps) stay
          non-wrapping with `truncate + title`; descriptive columns (name,
          statusReason) wrap with `break-words`. */}
      <td
        className="truncate px-4 py-4 font-mono text-sm font-medium text-slate-900"
        title={instrument.ticker}
      >
        {instrument.ticker}
      </td>
      <td className="break-words px-4 py-4 text-sm text-slate-700">
        {instrument.name ?? t.notListedLabel}
      </td>
      <td
        className="whitespace-nowrap px-4 py-4 text-sm text-slate-700"
        title={instrument.marketCode}
      >
        {instrument.marketCode}
      </td>
      <td className="px-4 py-4">
        <StatusBadge status={instrument.status} ticker={instrument.ticker} />
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-right text-sm text-slate-700">
        {instrument.absenceStreak}
      </td>
      <td
        className="whitespace-nowrap px-4 py-4 text-sm text-slate-600"
        title={instrument.lastSeenInCatalogAt ?? ""}
      >
        {formatTimestamp(instrument.lastSeenInCatalogAt)}
      </td>
      <td
        className="whitespace-nowrap px-4 py-4 text-sm text-slate-600"
        title={instrument.delistedAt ?? ""}
      >
        {formatTimestamp(instrument.delistedAt)}
      </td>
      <td className="break-words px-4 py-4 text-sm text-slate-600">
        {instrument.statusReason ?? t.notListedLabel}
      </td>
      <td className="px-4 py-4">
        <InstrumentActions
          instrument={instrument}
          busy={busy}
          onUndelete={onUndelete}
          onToggleExclusion={onToggleExclusion}
        />
      </td>
    </tr>
  );
}

function InstrumentCard({
  instrument,
  busy,
  onUndelete,
  onToggleExclusion,
}: {
  instrument: AdminInstrumentDto;
  busy: boolean;
  onUndelete: (instrument: AdminInstrumentDto) => void;
  onToggleExclusion: (instrument: AdminInstrumentDto) => void;
}) {
  return (
    <article
      className="rounded-[22px] border border-slate-200 bg-white/92 p-4 shadow-[0_16px_30px_rgba(148,163,184,0.12)]"
      data-testid={`instrument-card-${instrument.ticker}`}
    >
      {/* KZO-199 iter 3 — opaque-ID columns (ticker, marketCode) and ISO
          timestamp columns (lastSeen, delistedAt) use the non-wrapping
          variant of CardDetail (`truncate + title`). Descriptive columns
          (name, statusReason) keep `break-words`. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {t.tickerLabel}
          </p>
          <p
            className="mt-1 truncate font-mono text-sm font-medium text-slate-900"
            title={instrument.ticker}
          >
            {instrument.ticker}
          </p>
          <p className="mt-1 text-sm text-slate-700 break-words">
            {instrument.name ?? t.notListedLabel}
          </p>
        </div>
        <StatusBadge
          status={instrument.status}
          ticker={instrument.ticker}
          testIdPrefix="instrument-status-badge-card"
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <CardDetail label={t.marketLabel} value={instrument.marketCode} truncate />
        <CardDetail
          label={t.absenceStreakLabel}
          value={String(instrument.absenceStreak)}
          truncate
        />
        <CardDetail
          label={t.lastSeenLabel}
          value={formatTimestamp(instrument.lastSeenInCatalogAt)}
          truncate
        />
        <CardDetail
          label={t.delistedAtLabel}
          value={formatTimestamp(instrument.delistedAt)}
          truncate
        />
        <CardDetail
          label={t.statusReasonLabel}
          value={instrument.statusReason ?? t.notListedLabel}
        />
      </dl>

      <div className="mt-4">
        <InstrumentActions
          instrument={instrument}
          busy={busy}
          onUndelete={onUndelete}
          onToggleExclusion={onToggleExclusion}
          testIdSuffix="-card"
        />
      </div>
    </article>
  );
}

function CardDetail({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string;
  /** KZO-199 iter 3 — opt-in non-wrapping mode for opaque IDs / ISO timestamps. */
  truncate?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd
        className={`mt-1 text-sm font-medium text-slate-900 ${truncate ? "truncate" : "break-words"}`}
        title={truncate ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

interface AdminInstrumentsClientProps {
  initialData: AdminInstrumentsResponse;
}

export function AdminInstrumentsClient({ initialData }: AdminInstrumentsClientProps) {
  const [data, setData] = useState<AdminInstrumentsResponse>(initialData);
  const [page, setPage] = useState(initialData.page);
  const [limit] = useState(initialData.limit);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<RowActionsState>({
    busyTicker: null,
    error: null,
  });

  const fetchInstruments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("marketCode", "AU");
      params.set("page", String(page));
      params.set("limit", String(limit));
      const next = await getJson<AdminInstrumentsResponse>(
        `/admin/instruments?${params.toString()}`,
      );
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadFailedLabel);
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    if (page === initialData.page) return;
    void fetchInstruments();
  }, [fetchInstruments, page, initialData.page]);

  const handleUndelete = useCallback(
    async (instrument: AdminInstrumentDto) => {
      const confirmMessage = t.undeleteConfirmLabel.replace(
        "{ticker}",
        instrument.ticker,
      );
      if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
        return;
      }
      setActions({ busyTicker: instrument.ticker, error: null });
      try {
        await postJson<void>(
          `/admin/instruments/${encodeURIComponent(instrument.ticker)}/${encodeURIComponent(instrument.marketCode)}/undelete`,
          {},
        );
        await fetchInstruments();
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Undelete failed";
        setActions({ busyTicker: null, error: msg });
        return;
      }
      setActions({ busyTicker: null, error: null });
    },
    [fetchInstruments],
  );

  const handleToggleExclusion = useCallback(
    async (instrument: AdminInstrumentDto) => {
      const nextExcluded = !instrument.delistingDetectionExcluded;
      const tmpl = nextExcluded ? t.excludeConfirmLabel : t.includeConfirmLabel;
      const confirmMessage = tmpl.replace("{ticker}", instrument.ticker);
      if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
        return;
      }
      setActions({ busyTicker: instrument.ticker, error: null });
      try {
        await postJson<void>(
          `/admin/instruments/${encodeURIComponent(instrument.ticker)}/${encodeURIComponent(instrument.marketCode)}/exclude`,
          { excluded: nextExcluded },
        );
        await fetchInstruments();
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Toggle failed";
        setActions({ busyTicker: null, error: msg });
        return;
      }
      setActions({ busyTicker: null, error: null });
    },
    [fetchInstruments],
  );

  const items = data.items;
  const total = data.total;
  const thresholds = data.thresholds;

  return (
    <div className="space-y-6" data-testid="admin-instruments-page">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-500/78">
          {t.pageTitle}
        </p>
        <h1 className="mt-2 text-2xl text-slate-950 sm:text-3xl">{t.pageTitle}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          {t.pageDescription}
        </p>
      </div>

      <Card data-testid="admin-instruments-thresholds">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            {t.thresholdsTitle}
          </h2>
          <p className="text-xs text-slate-500">
            {t.thresholdsDescription.split("{settingsLink}").map((segment, i, arr) => (
              <span key={i}>
                {segment}
                {i < arr.length - 1 ? (
                  <Link
                    href="/admin/settings"
                    className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
                    data-testid="admin-instruments-thresholds-settings-link"
                  >
                    {t.settingsLinkLabel}
                  </Link>
                ) : null}
              </span>
            ))}
          </p>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CardDetail
            label={t.thresholdAbsenceLabel}
            value={`${thresholds.catalogAbsenceThreshold} ${t.thresholdAbsenceUnit}`}
          />
          <CardDetail
            label={t.thresholdGuardPercentLabel}
            value={`${thresholds.catalogAbsenceGuardPercent.toFixed(2)}%`}
          />
          <CardDetail
            label={t.thresholdGuardFloorLabel}
            value={`${thresholds.catalogAbsenceGuardFloor} ${t.thresholdGuardFloorUnit}`}
          />
        </dl>
      </Card>

      {actions.error ? (
        <div
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          data-testid="admin-instruments-action-error"
        >
          {actions.error}
        </div>
      ) : null}

      <Card data-testid="admin-instruments-section" className="overflow-hidden p-0 hover:translate-y-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{t.loadingLabel}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-rose-600">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchInstruments()}
            >
              {t.errorRetryLabel}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{t.emptyLabel}</p>
          </div>
        ) : (
          <>
            {/* KZO-199: drop the horizontal scroll on the table wrapper at the
                lg breakpoint; descriptive cells now wrap to their next line so
                narrow desktop viewports (≥1024px but <1280px) don't paint a
                horizontal scrollbar. Opaque-ID columns (ticker, marketCode,
                timestamps) keep `whitespace-nowrap + title` to stay legible. */}
            <div className="hidden lg:block">
              <table
                className="w-full table-fixed border-collapse text-sm text-slate-700"
                data-testid="admin-instruments-table"
              >
                <thead>
                  <tr className="bg-slate-50 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    <th className="px-4 py-3 text-left font-medium">{t.tickerLabel}</th>
                    <th className="px-4 py-3 text-left font-medium">{t.nameLabel}</th>
                    <th className="px-4 py-3 text-left font-medium">{t.marketLabel}</th>
                    <th className="px-4 py-3 text-left font-medium">{t.statusLabel}</th>
                    <th className="px-4 py-3 text-right font-medium">
                      {t.absenceStreakLabel}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">{t.lastSeenLabel}</th>
                    <th className="px-4 py-3 text-left font-medium">{t.delistedAtLabel}</th>
                    <th className="px-4 py-3 text-left font-medium">
                      {t.statusReasonLabel}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">{t.actionsLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((instrument) => (
                    <InstrumentRow
                      key={`${instrument.ticker}-${instrument.marketCode}`}
                      instrument={instrument}
                      busy={actions.busyTicker === instrument.ticker}
                      onUndelete={handleUndelete}
                      onToggleExclusion={handleToggleExclusion}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div
              className="grid gap-3 p-4 lg:hidden"
              data-testid="admin-instruments-cards"
            >
              {items.map((instrument) => (
                <InstrumentCard
                  key={`${instrument.ticker}-${instrument.marketCode}`}
                  instrument={instrument}
                  busy={actions.busyTicker === instrument.ticker}
                  onUndelete={handleUndelete}
                  onToggleExclusion={handleToggleExclusion}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      {!loading && !error && total > 0 ? (
        <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
      ) : null}
    </div>
  );
}
