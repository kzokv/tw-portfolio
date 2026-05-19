"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui/Button";
import type { AppDictionary } from "../../../lib/i18n";

export interface RepairModalValue {
  startDate: string;
  endDate: string;
  includeBars: boolean;
  includeDividends: boolean;
}

interface RepairModalProps {
  open: boolean;
  pending: boolean;
  title: string;
  subtitle?: string;
  value: RepairModalValue;
  onOpenChange: (open: boolean) => void;
  onChange: (next: RepairModalValue) => void;
  onSubmit: () => Promise<void> | void;
  dict: AppDictionary;
  children?: ReactNode;
  isValid?: boolean;
}

export function RepairModal({
  open,
  pending,
  title,
  subtitle,
  value,
  onOpenChange,
  onChange,
  onSubmit,
  dict,
  children,
  isValid = true,
}: RepairModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/80" />
        <Dialog.Content
          className="!fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none sm:p-6"
          data-testid="repair-modal"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
              {subtitle ? <Dialog.Description className="mt-1 text-sm text-muted-foreground">{subtitle}</Dialog.Description> : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
              aria-label={dict.settings.repairModalClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground" data-testid="repair-start-date-field">
                <span>{dict.settings.repairStartDate}</span>
                <input
                  type="date"
                  name="startDate"
                  value={value.startDate}
                  onChange={(event) => onChange({ ...value, startDate: event.target.value })}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                  data-testid="repair-start-date"
                />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground" data-testid="repair-end-date-field">
                <span>{dict.settings.repairEndDate}</span>
                <input
                  type="date"
                  name="endDate"
                  value={value.endDate}
                  onChange={(event) => onChange({ ...value, endDate: event.target.value })}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                  data-testid="repair-end-date"
                />
              </label>
            </div>

            <div className="space-y-2 rounded-xl border border-border bg-background/70 p-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{dict.settings.repairIncludeTitle}</p>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={value.includeBars}
                  onChange={(event) => onChange({ ...value, includeBars: event.target.checked })}
                  className="h-4 w-4 rounded border-input"
                  data-testid="repair-include-bars"
                />
                <span>{dict.settings.repairIncludeBars}</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={value.includeDividends}
                  onChange={(event) => onChange({ ...value, includeDividends: event.target.checked })}
                  className="h-4 w-4 rounded border-input"
                  data-testid="repair-include-dividends"
                />
                <span>{dict.settings.repairIncludeDividends}</span>
              </label>
            </div>

            {!value.includeBars && !value.includeDividends ? (
              <p className="text-xs text-rose-600">{dict.settings.repairValidationSelectOne}</p>
            ) : null}

            {children}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              {dict.actions.cancel}
            </Button>
            <Button
              onClick={() => void onSubmit()}
              disabled={pending || !isValid || (!value.includeBars && !value.includeDividends)}
              data-testid="repair-submit"
            >
              {pending ? dict.settings.repairSubmitting : dict.settings.repairSubmit}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
