"use client";

// Phase 5e — floating ⨁ button + bottom/right Sheet with three actions:
//   1. Add transaction → opens existing AddTransactionDialog
//   2. Recompute portfolio → opens existing RecomputeConfirmDialog
//   3. Generate snapshots → invokes existing generateSnapshots handler
//
// Hidden when isSharedContext === true (shared context is read-only).
// Sheet uses side="bottom" on <md (thumb reach), side="right" at ≥md.

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";
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
  /** Hide the floating trigger entirely when viewing a shared context. */
  hidden: boolean;
  onAddTransaction: () => void;
  onRecompute: () => void;
  onGenerateSnapshots: () => void | Promise<void>;
  isGeneratingSnapshots: boolean;
}

export function FloatingQuickActions({
  hidden,
  onAddTransaction,
  onRecompute,
  onGenerateSnapshots,
  isGeneratingSnapshots,
}: FloatingQuickActionsProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  if (hidden) return null;

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          // Fixed positioning: bottom-right with safe-area padding for iOS.
          // z-40 below shadcn Sheet/Dialog (z-50) but above page content.
          className="fixed bottom-4 right-4 z-40 size-12 rounded-full p-0 shadow-lg sm:bottom-6 sm:right-6"
          aria-label="Quick actions"
          data-testid="floating-quick-actions-trigger"
        >
          <Plus className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        data-testid="floating-quick-actions-sheet"
        className="flex flex-col gap-3"
      >
        <SheetHeader>
          <SheetTitle>Quick actions</SheetTitle>
          <SheetDescription className="sr-only">
            Dashboard quick action shortcuts
          </SheetDescription>
        </SheetHeader>
        <Button
          variant="default"
          className="w-full justify-start"
          onClick={() => {
            close();
            onAddTransaction();
          }}
          data-testid="floating-action-add-transaction"
        >
          Add transaction
        </Button>
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={() => {
            close();
            onRecompute();
          }}
          data-testid="floating-action-recompute"
        >
          Recompute portfolio
        </Button>
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
          {isGeneratingSnapshots ? "Generating…" : "Generate snapshots"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
