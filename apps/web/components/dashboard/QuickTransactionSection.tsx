"use client";

import { useState } from "react";
import type { SymbolOptionDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { AddTransactionCard } from "../portfolio/AddTransactionCard";
import type { TransactionInput } from "../portfolio/types";

interface QuickTransactionSectionProps {
  value: TransactionInput;
  accountOptions: Array<{ id: string; name: string }>;
  symbolOptions: SymbolOptionDto[];
  pending: boolean;
  onChange: (next: TransactionInput) => void;
  onSubmit: () => Promise<void>;
  dict: AppDictionary;
}

export function QuickTransactionSection({
  value,
  accountOptions,
  symbolOptions,
  pending,
  onChange,
  onSubmit,
  dict,
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
            <p className="text-sm font-medium text-slate-100">{typeLabel} {value.symbol}</p>
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
              symbolOptions={symbolOptions}
              pending={pending}
              onChange={onChange}
              onSubmit={onSubmit}
              dict={dict}
              framed={false}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
