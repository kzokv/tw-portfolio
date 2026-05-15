"use client";

import { useState } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { TransactionPriceHint } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { TransactionEstimateResponse } from "../../features/portfolio/services/portfolioService";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { AddTransactionCard, type TransactionAccountOption } from "../portfolio/AddTransactionCard";
import type { TransactionInput } from "../portfolio/types";

interface QuickTransactionSectionProps {
  value: TransactionInput;
  accountOptions: TransactionAccountOption[];
  pending: boolean;
  onChange: (next: TransactionInput) => void;
  onUnitPriceEdited?: () => void;
  onSubmit: () => Promise<void>;
  dict: AppDictionary;
  locale: LocaleCode;
  priceHint: TransactionPriceHint | null;
  showPriceUnavailableHint: boolean;
  feeEstimate: TransactionEstimateResponse | null;
}

export function QuickTransactionSection({
  value,
  accountOptions,
  pending,
  onChange,
  onUnitPriceEdited,
  onSubmit,
  dict,
  locale,
  priceHint,
  showPriceUnavailableHint,
  feeEstimate,
}: QuickTransactionSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const typeLabel = value.type === "BUY" ? dict.transactions.typeBuy : dict.transactions.typeSell;

  return (
    <Card data-testid="dashboard-quick-transaction-section">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{dict.dashboardHome.quickTransactionTitle}</p>
          <h2 className="mt-2 text-2xl text-ink">{dict.dashboardHome.quickTransactionTitle}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">{dict.dashboardHome.quickTransactionDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-white/10 bg-slate-950/30 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-100">{typeLabel} {value.ticker}</p>
            <p className="mt-1 text-sm text-slate-400">{value.accountId || dict.feedback.noAccounts}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setExpanded((current) => !current)}
            data-testid="quick-transaction-toggle"
          >
            {expanded ? dict.dashboardHome.collapseQuickTransaction : dict.dashboardHome.expandQuickTransaction}
          </Button>
        </div>

        {expanded ? (
          <div className="rounded-[22px] border border-white/10 bg-slate-950/25 p-4">
            <AddTransactionCard
              value={value}
              accountOptions={accountOptions}
              pending={pending}
              onChange={onChange}
              onUnitPriceEdited={onUnitPriceEdited}
              onSubmit={onSubmit}
              dict={dict}
              locale={locale}
              framed={false}
              priceHint={priceHint}
              showPriceUnavailableHint={showPriceUnavailableHint}
              feeEstimate={feeEstimate}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
