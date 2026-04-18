"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import { buttonVariants } from "../ui/Button";
import type { SharingPageData } from "../../features/sharing/types";
import { writeContextCookie } from "../../lib/context";
import { getDictionary } from "../../lib/i18n";
import { cn, formatDateLabel } from "../../lib/utils";
import { Card } from "../ui/Card";

interface InboundSharesCardsProps {
  locale: LocaleCode;
  inbound: SharingPageData["inbound"];
}

export function InboundSharesCards({ locale, inbound }: InboundSharesCardsProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const router = useRouter();
  const totalCount = inbound.active.length + inbound.revoked.length;

  const handleOpenDashboard = (ownerUserId: string | null) => {
    if (ownerUserId) writeContextCookie(ownerUserId);
    router.push("/dashboard");
  };

  return (
    <Card className="space-y-5" data-testid="sharing-inbound-section">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">{dict.sharing.inboundTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{dict.sharing.inboundDescription}</p>
      </div>

      {totalCount === 0 ? (
        <div
          className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center"
          data-testid="sharing-inbound-empty"
        >
          <p className="text-base font-semibold text-slate-900">{dict.sharing.emptyInboundTitle}</p>
          <p className="mt-2 text-sm text-slate-600">{dict.sharing.emptyInboundDescription}</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {inbound.active.map((item) => (
            <article
              key={item.id}
              className="rounded-[24px] border border-slate-200 bg-white/80 p-5 shadow-[0_18px_40px_rgba(148,163,184,0.12)]"
              data-testid={`sharing-inbound-card-${item.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-slate-950">
                    {item.ownerDisplayName || item.ownerEmail}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{item.ownerEmail}</p>
                </div>
                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  {dict.sharing.status.active}
                </span>
              </div>
              <p className="mt-4 text-sm text-slate-600">
                {dict.sharing.row.grantedOn.replace("{date}", formatDateLabel(item.createdAt, locale))}
              </p>
              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">{dict.sharing.switcherHint}</p>
                <button
                  type="button"
                  onClick={() => handleOpenDashboard(item.ownerUserId)}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0")}
                  data-testid={`sharing-open-dashboard-${item.id}`}
                >
                  {dict.sharing.actions.openSwitcher}
                </button>
              </div>
            </article>
          ))}

          {inbound.revoked.map((item) => (
            <article
              key={item.id}
              className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5"
              data-testid={`sharing-inbound-revoked-${item.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-slate-900">
                    {item.ownerDisplayName || item.ownerEmail}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{item.ownerEmail}</p>
                </div>
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {dict.sharing.status.revoked}
                </span>
              </div>
              {item.revokedAt ? (
                <p className="mt-4 text-sm text-slate-600">
                  {dict.sharing.row.revokedOn.replace("{date}", formatDateLabel(item.revokedAt, locale))}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
