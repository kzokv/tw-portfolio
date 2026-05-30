"use client";

import type { AppDictionary } from "../../lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/shadcn/alert-dialog";

interface RecomputeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Invoked on user confirm. The caller should drive
   *  `useRecomputeAction.runRecompute({ skipConfirm: true })` from here. */
  onConfirm: () => void;
  dict: AppDictionary;
  pending?: boolean;
}

/**
 * Phase 3e §12 A2 — shadcn `AlertDialog` confirming the `action.recompute.all`
 * command. Replaces the legacy `window.confirm` for the ⌘K-driven recompute
 * surface; the per-page Recompute button on `/portfolio` retains its existing
 * inline confirmation flow.
 *
 * Locked testids (spec §12 A2):
 *   - recompute-confirm-dialog
 *   - recompute-confirm-dialog-cta
 *   - recompute-confirm-dialog-cancel
 */
export function RecomputeConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  dict,
  pending = false,
}: RecomputeConfirmDialogProps) {
  const cp = dict.commandPalette;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="recompute-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{cp.recomputeConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{cp.recomputeConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="recompute-confirm-dialog-cancel" disabled={pending}>
            {cp.recomputeConfirmCancel}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="recompute-confirm-dialog-cta"
            onClick={() => onConfirm()}
            disabled={pending}
          >
            {cp.recomputeConfirmCta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
