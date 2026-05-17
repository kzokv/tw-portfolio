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
import { DataTable, type DataTableColumn } from "../ui/DataTable";
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
}: {
  status: AdminInstrumentStatus;
  ticker: string;
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
      data-testid={`instrument-status-badge-${ticker}`}
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
}

function InstrumentActions({
  instrument,
  busy,
  onUndelete,
  onToggleExclusion,
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
          data-testid={`instrument-undelete-btn-${ticker}`}
        >
          {busy ? t.workingLabel : t.undeleteButtonLabel}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onToggleExclusion(instrument)}
        data-testid={`instrument-exclude-toggle-btn-${ticker}`}
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

function CardDetail({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 text-sm font-medium text-foreground ${truncate ? "truncate" : "break-words"}`}
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

  // Phase 4 — DataTable migration. Admin = desktop-first per scope-grill
  // (no mobileRow); scroll-with-sticky-ticker at all viewports.
  const columns: DataTableColumn<AdminInstrumentDto>[] = [
    {
      key: "ticker",
      header: t.tickerLabel,
      render: (i) => (
        <span className="truncate font-mono text-sm font-medium text-foreground" title={i.ticker}>
          {i.ticker}
        </span>
      ),
    },
    {
      key: "name",
      header: t.nameLabel,
      render: (i) => <span className="break-words text-sm text-foreground">{i.name ?? t.notListedLabel}</span>,
    },
    {
      key: "market",
      header: t.marketLabel,
      render: (i) => <span className="whitespace-nowrap text-sm text-foreground" title={i.marketCode}>{i.marketCode}</span>,
    },
    {
      key: "status",
      header: t.statusLabel,
      render: (i) => <StatusBadge status={i.status} ticker={i.ticker} />,
    },
    {
      key: "absenceStreak",
      header: t.absenceStreakLabel,
      render: (i) => <span className="whitespace-nowrap text-right text-sm text-foreground">{i.absenceStreak}</span>,
    },
    {
      key: "lastSeen",
      header: t.lastSeenLabel,
      render: (i) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground" title={i.lastSeenInCatalogAt ?? ""}>
          {formatTimestamp(i.lastSeenInCatalogAt)}
        </span>
      ),
    },
    {
      key: "delistedAt",
      header: t.delistedAtLabel,
      render: (i) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground" title={i.delistedAt ?? ""}>
          {formatTimestamp(i.delistedAt)}
        </span>
      ),
    },
    {
      key: "statusReason",
      header: t.statusReasonLabel,
      render: (i) => <span className="break-words text-sm text-muted-foreground">{i.statusReason ?? t.notListedLabel}</span>,
    },
    {
      key: "actions",
      header: t.actionsLabel,
      render: (i) => (
        <InstrumentActions
          instrument={i}
          busy={actions.busyTicker === i.ticker}
          onUndelete={handleUndelete}
          onToggleExclusion={handleToggleExclusion}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6" data-testid="admin-instruments-page">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">
          {t.pageTitle}
        </p>
        <h1 className="mt-2 text-2xl text-foreground sm:text-3xl">{t.pageTitle}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t.pageDescription}
        </p>
      </div>

      <Card data-testid="admin-instruments-thresholds">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {t.thresholdsTitle}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t.thresholdsDescription.split("{settingsLink}").map((segment, i, arr) => (
              <span key={i}>
                {segment}
                {i < arr.length - 1 ? (
                  <Link
                    href="/admin/settings"
                    className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:text-primary/80"
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
            <p className="text-sm text-muted-foreground">{t.loadingLabel}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchInstruments()}
            >
              {t.errorRetryLabel}
            </Button>
          </div>
        ) : (
          <DataTable
            data={items}
            columns={columns}
            rowKey={(i) => `${i.ticker}-${i.marketCode}`}
            rowTestId={(i) => `instrument-row-${i.ticker}`}
            data-testid="admin-instruments-table"
            stickyFirstColumn
            emptyState={
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">{t.emptyLabel}</p>
              </div>
            }
          />
        )}
      </Card>

      {!loading && !error && total > 0 ? (
        <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
      ) : null}
    </div>
  );
}
