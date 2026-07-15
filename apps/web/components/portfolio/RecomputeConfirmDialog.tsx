"use client";

import { Loader2 } from "lucide-react";
import type {
  LocaleCode,
  RecomputeFeeMode,
  RecomputePreviewDto,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount } from "../../lib/utils";
import { Button } from "../ui/Button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/shadcn/alert-dialog";
import { Label } from "../ui/shadcn/label";
import { RadioGroup, RadioGroupItem } from "../ui/shadcn/radio-group";

interface RecomputeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feeMode: RecomputeFeeMode;
  onFeeModeChange: (mode: RecomputeFeeMode) => void;
  preview: RecomputePreviewDto | null;
  onRequestPreview: () => void;
  onConfirm: () => void;
  dict: AppDictionary;
  locale: LocaleCode;
  isPreviewLoading: boolean;
  isConfirming: boolean;
  errorMessage: string;
  statusMessage: string;
}

export function RecomputeConfirmDialog({
  open,
  onOpenChange,
  feeMode,
  onFeeModeChange,
  preview,
  onRequestPreview,
  onConfirm,
  dict,
  locale,
  isPreviewLoading,
  isConfirming,
  errorMessage,
  statusMessage,
}: RecomputeConfirmDialogProps) {
  const cp = dict.commandPalette;
  const copy = dict.recompute;
  const pending = isPreviewLoading || isConfirming;
  const noFeeChanges = preview != null && preview.counts.changed === 0;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isConfirming) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent
        className="max-h-[min(90vh,760px)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl"
        data-testid="recompute-confirm-dialog"
        aria-busy={pending}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{cp.recomputeConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{cp.recomputeConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>

        <fieldset disabled={pending} className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">{copy.feeModeTitle}</legend>
          <RadioGroup
            value={feeMode}
            onValueChange={(value) => onFeeModeChange(value as RecomputeFeeMode)}
            className="grid gap-3"
            aria-label={copy.feeModeTitle}
          >
            <Label htmlFor="recompute-mode-keep" className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 leading-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
              <RadioGroupItem id="recompute-mode-keep" value="KEEP_RECORDED" data-testid="recompute-mode-keep" className="mt-0.5 shrink-0" />
              <span>
                <span className="block font-medium text-foreground">{copy.keepRecordedTitle}</span>
                <span className="mt-1 block text-sm font-normal text-muted-foreground">{copy.keepRecordedDescription}</span>
              </span>
            </Label>
            <Label htmlFor="recompute-mode-recalculate" className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 leading-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
              <RadioGroupItem id="recompute-mode-recalculate" value="RECALCULATE_CALCULATED" data-testid="recompute-mode-recalculate" className="mt-0.5 shrink-0" />
              <span>
                <span className="block font-medium text-foreground">{copy.recalculateCalculatedTitle}</span>
                <span className="mt-1 block text-sm font-normal text-muted-foreground">{copy.recalculateCalculatedDescription}</span>
              </span>
            </Label>
          </RadioGroup>
        </fieldset>

        {preview ? (
          <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-4" data-testid="recompute-impact-preview" aria-labelledby="recompute-impact-title">
            <h3 id="recompute-impact-title" className="text-sm font-semibold text-foreground">{copy.impactTitle}</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[
                [copy.totalCount, preview.counts.total],
                [copy.calculatedCount, preview.counts.calculated],
                [copy.preservedCount, preview.counts.preserved],
                [copy.changedCount, preview.counts.changed],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md bg-background px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            {noFeeChanges ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="recompute-zero-change">
                {copy.noFeeChanges}
              </p>
            ) : null}
            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {preview.impactsByCurrency.map((impact) => (
                <div key={impact.currency} className="grid gap-2 rounded-md border border-border/70 bg-background p-3 text-sm sm:grid-cols-[auto_1fr_1fr] sm:items-center">
                  <span className="font-semibold text-foreground">{impact.currency}</span>
                  <span className="text-muted-foreground">
                    {copy.commissionDelta}: <span className="font-medium tabular-nums text-foreground">{formatCurrencyAmount(impact.commissionDelta, impact.currency, locale)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {copy.taxDelta}: <span className="font-medium tabular-nums text-foreground">{formatCurrencyAmount(impact.taxDelta, impact.currency, locale)}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div aria-live="polite" aria-atomic="true">
          {statusMessage ? <p role="status" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{statusMessage}</p> : null}
          {errorMessage ? <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{errorMessage}</p> : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="recompute-confirm-dialog-cancel" disabled={pending}>
            {cp.recomputeConfirmCancel}
          </AlertDialogCancel>
          <Button
            data-testid="recompute-confirm-dialog-cta"
            onClick={preview ? onConfirm : onRequestPreview}
            disabled={pending}
            className="gap-2"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isPreviewLoading
              ? copy.previewingAction
              : isConfirming
                ? copy.applyingAction
                : preview
                  ? copy.applyAction
                  : copy.reviewImpactAction}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
