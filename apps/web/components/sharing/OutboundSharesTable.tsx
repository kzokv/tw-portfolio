"use client";

import { useMemo } from "react";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import type { OutboundShareRow, SharingPageData } from "../../features/sharing/types";
import { getDictionary } from "../../lib/i18n";
import { cn, formatDateLabel } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface OutboundSharesTableProps {
  locale: LocaleCode;
  outbound: SharingPageData["outbound"];
  showHistory: boolean;
  onToggleHistory: () => void;
  onCopyUrl: (row: OutboundShareRow) => void;
  onRevoke: (row: OutboundShareRow) => void;
  onReshare: (row: OutboundShareRow) => void;
}

const STATUS_STYLES: Record<OutboundShareRow["status"], string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-sky-200 bg-sky-50 text-sky-700",
  expired: "border-amber-200 bg-amber-50 text-amber-700",
  revoked: "border-slate-200 bg-slate-100 text-slate-600",
};

function formatOptionalDate(value: string | null, locale: LocaleCode): string {
  return value ? formatDateLabel(value, locale) : "—";
}

export function OutboundSharesTable({
  locale,
  outbound,
  showHistory,
  onToggleHistory,
  onCopyUrl,
  onRevoke,
  onReshare,
}: OutboundSharesTableProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const rows = useMemo(
    () => [
      ...outbound.active,
      ...outbound.pending,
      ...outbound.expired,
      ...(showHistory ? outbound.revoked : []),
    ],
    [outbound.active, outbound.expired, outbound.pending, outbound.revoked, showHistory],
  );

  return (
    <Card className="space-y-5" data-testid="sharing-outbound-section">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{dict.sharing.sharedByYouTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">{dict.sharing.sharedByYouDescription}</p>
        </div>
        {outbound.revoked.length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white"
            onClick={onToggleHistory}
            data-testid="sharing-history-toggle"
          >
            {dict.sharing.showHistory}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              {outbound.revoked.length}
            </span>
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center"
          data-testid="sharing-outbound-empty"
        >
          <p className="text-base font-semibold text-slate-900">{dict.sharing.emptyManageStateTitle}</p>
          <p className="mt-2 text-sm text-slate-600">{dict.sharing.emptyManageStateDescription}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm" data-testid="sharing-outbound-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.sharing.table.grantee}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.sharing.table.status}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.sharing.table.created}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.sharing.table.expires}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.sharing.table.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 last:border-0"
                  data-testid={`sharing-outbound-row-${row.id}`}
                >
                  <td className="px-4 py-4 align-top">
                    <div className="font-medium text-slate-900">{row.email}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.displayName ?? dict.sharing.row.notRegistered}
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", STATUS_STYLES[row.status])}>
                      {dict.sharing.status[row.status]}
                    </span>
                    {row.status === "revoked" && row.revokedAt ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {dict.sharing.row.revokedOn.replace("{date}", formatDateLabel(row.revokedAt, locale))}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">{formatDateLabel(row.createdAt, locale)}</td>
                  <td className="px-4 py-4 align-top text-slate-600">{formatOptionalDate(row.expiresAt, locale)}</td>
                  <td className="px-4 py-4 align-top">
                    <div className="flex justify-end gap-2">
                      {row.status === "pending" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onCopyUrl(row)}
                          data-testid={`sharing-copy-url-${row.id}`}
                        >
                          {dict.sharing.actions.copyUrl}
                        </Button>
                      ) : null}
                      {row.status === "active" || row.status === "pending" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onRevoke(row)}
                          data-testid={`sharing-revoke-${row.id}`}
                        >
                          {dict.sharing.actions.revoke}
                        </Button>
                      ) : null}
                      {row.status === "expired" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onReshare(row)}
                          data-testid={`sharing-reshare-${row.id}`}
                        >
                          {dict.sharing.actions.reshare}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
