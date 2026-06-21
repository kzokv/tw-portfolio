import type { LocaleCode, TransactionHistoryItemDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Card } from "../ui/Card";
import { TransactionHistoryTable } from "../transactions/TransactionHistoryTable";

interface RecentTransactionsCardProps {
  items: TransactionHistoryItemDto[];
  locale: LocaleCode;
  dict: AppDictionary;
  isLoading: boolean;
  errorMessage: string;
  variant?: "default" | "primary";
}

export function RecentTransactionsCard({
  items,
  locale,
  dict,
  isLoading,
  errorMessage,
  variant = "default",
}: RecentTransactionsCardProps) {
  const isPrimary = variant === "primary";

  return (
    <Card className="border border-border bg-card" data-testid="recent-transactions-card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/78">
        {isPrimary ? dict.navigation.transactionsLabel : dict.transactions.recentLedgerTitle}
      </p>
      <h2 className={cn("text-foreground", isPrimary ? "mt-2 text-2xl sm:text-3xl" : "mt-2 text-2xl")}>
        {dict.transactions.recentLedgerTitle}
      </h2>
      <p className={cn("text-sm leading-6 text-muted-foreground", isPrimary ? "mt-2" : "mt-3")}>
        {dict.transactions.recentLedgerDescription}
      </p>

      {errorMessage ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-6 grid gap-3" aria-hidden="true">
          <div className="skeleton-line h-14 rounded-xl" />
          <div className="skeleton-line skeleton-line--delay h-14 rounded-xl" />
          <div className="skeleton-line h-14 rounded-xl" />
        </div>
      ) : (
        <div className="mt-6">
          {isPrimary ? (
            <p className="mb-3 rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
              {dict.tickerHistory.realizedPnlWeightedAverageNote}
            </p>
          ) : null}
          <TransactionHistoryTable
            dict={{
              ...dict,
              transactions: {
                ...dict.transactions,
                historyEmpty: dict.transactions.recentLedgerEmpty,
              },
            }}
            items={items}
            locale={locale}
            mode="compact"
            tableTestId="recent-transactions-table"
          />
        </div>
      )}
    </Card>
  );
}
