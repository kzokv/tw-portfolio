"use client";

import { useState } from "react";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  type AccountDefaultCurrency,
} from "@vakwen/shared-types";
import {
  CircleDollarSign,
  FileClock,
  Plus,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import type { AppDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/shadcn/sheet";
import { useIsMobile } from "../../lib/hooks/use-mobile";

interface FloatingQuickActionsProps {
  hidden: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportingCurrency: AccountDefaultCurrency;
  onReportingCurrencyChange: (currency: AccountDefaultCurrency) => Promise<void>;
  isReportingCurrencySaving: boolean;
  reportingCurrencyError: string;
  onAddTransaction: () => void;
  onRecompute: () => void;
  onGenerateSnapshots: () => void | Promise<void>;
  isGeneratingSnapshots: boolean;
  showRecomputeAction?: boolean;
  showGenerateSnapshotsAction?: boolean;
  dict: AppDictionary;
}

export function FloatingQuickActions({
  hidden,
  open,
  onOpenChange,
  reportingCurrency,
  onReportingCurrencyChange,
  isReportingCurrencySaving,
  reportingCurrencyError,
  onAddTransaction,
  onRecompute,
  onGenerateSnapshots,
  isGeneratingSnapshots,
  showRecomputeAction = true,
  showGenerateSnapshotsAction = true,
  dict,
}: FloatingQuickActionsProps) {
  const isMobile = useIsMobile();
  const [currencySaved, setCurrencySaved] = useState(false);

  if (hidden) return null;

  const close = () => onOpenChange(false);

  const handleCurrencyChange = async (value: string): Promise<void> => {
    if (!(ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(value)) return;
    setCurrencySaved(false);
    try {
      await onReportingCurrencyChange(value as AccountDefaultCurrency);
      setCurrencySaved(true);
    } catch {
      setCurrencySaved(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          className="fixed bottom-4 right-4 z-40 size-12 rounded-full p-0 shadow-lg sm:bottom-6 sm:right-6"
          aria-label={dict.commandPalette.quickActionsTitle}
          data-testid="floating-quick-actions-trigger"
        >
          <Plus aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        data-testid="floating-quick-actions-sheet"
        className="flex flex-col gap-3"
      >
        <SheetHeader>
          <SheetTitle>{dict.commandPalette.quickActionsTitle}</SheetTitle>
          <SheetDescription>{dict.commandPalette.quickActionsDescription}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CircleDollarSign data-icon="inline-start" aria-hidden="true" />
            {dict.commandPalette.actionChangeReportingCurrency}
          </div>
          <Select
            value={reportingCurrency}
            onValueChange={(value) => { void handleCurrencyChange(value); }}
            disabled={isReportingCurrencySaving}
          >
            <SelectTrigger data-testid="floating-action-reporting-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ACCOUNT_DEFAULT_CURRENCIES.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {currencySaved ? (
            <p className="text-xs text-muted-foreground">
              {dict.commandPalette.actionReportingCurrencySaved}
            </p>
          ) : null}
          {reportingCurrencyError ? (
            <p className="text-xs text-destructive" role="alert">
              {reportingCurrencyError}
            </p>
          ) : null}
        </div>

        <Button
          variant="default"
          className="w-full justify-start"
          onClick={() => {
            close();
            onAddTransaction();
          }}
          data-testid="floating-action-add-transaction"
        >
          <ReceiptText data-icon="inline-start" aria-hidden="true" />
          {dict.commandPalette.actionAddTransaction}
        </Button>
        {showRecomputeAction ? (
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => {
              close();
              onRecompute();
            }}
            data-testid="floating-action-recompute"
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            {dict.commandPalette.actionRecomputeAll}
          </Button>
        ) : null}
        {showGenerateSnapshotsAction ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              className="w-full justify-start"
              disabled={isGeneratingSnapshots}
              onClick={() => {
                close();
                void onGenerateSnapshots();
              }}
              data-testid="floating-action-generate-snapshots"
            >
              <FileClock data-icon="inline-start" aria-hidden="true" />
              {dict.commandPalette.actionGenerateSnapshots}
            </Button>
            <p className="px-1 text-xs text-muted-foreground" data-testid="floating-action-generate-snapshots-hint">
              {dict.commandPalette.actionGenerateSnapshotsHint}
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
