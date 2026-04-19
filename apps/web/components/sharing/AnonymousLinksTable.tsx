"use client";

import { useMemo } from "react";
import type { AnonymousShareTokenDto, LocaleCode } from "@tw-portfolio/shared-types";
import { getDictionary } from "../../lib/i18n";
import { cn, formatDateLabel } from "../../lib/utils";
import { Button } from "../ui/Button";

interface AnonymousLinksTableProps {
  locale: LocaleCode;
  tokens: AnonymousShareTokenDto[];
  justCreatedId: string | null;
  copyAffordanceId: string | null;
  copyFeedbackId: string | null;
  onCopyUrl: (token: AnonymousShareTokenDto) => void;
  onRevoke: (token: AnonymousShareTokenDto) => void;
}

const STATUS_DOT: Record<AnonymousShareTokenDto["status"], string> = {
  active: "bg-emerald-500",
  expired: "bg-slate-400",
  revoked: "bg-red-500",
};

const STATUS_TEXT: Record<AnonymousShareTokenDto["status"], string> = {
  active: "text-emerald-700",
  expired: "text-slate-500",
  revoked: "text-red-600",
};

function truncateToken(token: string): string {
  if (token.length <= 10) return token;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function AnonymousLinksTable({
  locale,
  tokens,
  justCreatedId,
  copyAffordanceId,
  copyFeedbackId,
  onCopyUrl,
  onRevoke,
}: AnonymousLinksTableProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const copy = dict.sharing.publicLinks;

  if (tokens.length === 0) {
    return (
      <div
        className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center"
        data-testid="sharing-public-links-empty"
      >
        <p className="text-sm text-slate-600">{copy.emptyState}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[42rem] text-sm" data-testid="sharing-public-links-table">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70">
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {copy.table.link}
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {copy.table.created}
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {copy.table.expires}
            </th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {copy.table.status}
            </th>
            <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {copy.table.actions}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tokens.map((token) => {
            const isJustCreated = justCreatedId === token.id;
            const isTerminal = token.status !== "active";
            const copied = copyFeedbackId === token.id;
            const showCopyAffordance = copyAffordanceId === token.id && !copied;
            return (
              <tr
                key={token.id}
                data-testid={`sharing-public-link-row-${token.id}`}
                className={cn(isJustCreated && "bg-indigo-50/40", isTerminal && "bg-slate-50/30")}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      className={cn(
                        "font-mono text-xs",
                        isTerminal ? "text-slate-500 line-through" : "text-slate-700",
                      )}
                      data-testid={`sharing-public-link-token-${token.id}`}
                    >
                      …/share/{truncateToken(token.token)}
                    </code>
                    {!isTerminal ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className={cn(
                          "h-7 px-2 text-[11px]",
                          showCopyAffordance && "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
                        )}
                        onClick={() => onCopyUrl(token)}
                        data-testid={`sharing-public-link-copy-${token.id}`}
                      >
                        {copied ? copy.copyUrlCopiedButton : copy.copyUrlButton}
                      </Button>
                    ) : null}
                    {isJustCreated ? (
                      <span
                        className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700"
                        data-testid={`sharing-public-link-new-badge-${token.id}`}
                      >
                        {copy.justCreatedBadge}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {formatDateLabel(token.createdAt, locale)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {formatDateLabel(token.expiresAt, locale)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn("inline-flex items-center gap-1.5 text-xs font-medium", STATUS_TEXT[token.status])}
                    data-testid={`sharing-public-link-status-${token.id}`}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[token.status])} />
                    {copy.status[token.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {!isTerminal ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 border-red-200 px-2 text-[11px] text-red-600 hover:border-red-300 hover:bg-red-50"
                      onClick={() => onRevoke(token)}
                      data-testid={`sharing-public-link-revoke-${token.id}`}
                    >
                      {copy.revokeButton}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
