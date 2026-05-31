"use client";

// Phase 1 adapter shim: preserves the public Drawer API while routing through
// shadcn's Sheet primitive (which itself wraps Radix Dialog). The bottom-on-
// mobile / right-on-md+ shape, dirty-confirm-close semantics, and existing
// data-testid contract all survive Phase 1.

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./Button";
import { Sheet, SheetPortal, SheetOverlay, SheetTitle } from "./shadcn/sheet";

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  dirty?: boolean;
  closeLabel?: string;
  dirtyConfirmMessage?: string;
  className?: string;
  bodyClassName?: string;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  footer,
  dirty = false,
  closeLabel = "Close drawer",
  dirtyConfirmMessage = "Discard changes?",
  className,
  bodyClassName,
}: DrawerProps) {
  function confirmClose(): boolean {
    if (!dirty) {
      return true;
    }
    return window.confirm(dirtyConfirmMessage);
  }

  function requestClose() {
    if (confirmClose()) {
      onOpenChange(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
          return;
        }
        requestClose();
      }}
    >
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-40 bg-foreground/38 backdrop-blur-sm data-[state=open]:animate-fade-in-up" />
        <SheetPrimitive.Content
          aria-describedby={undefined}
          aria-modal="true"
          onEscapeKeyDown={(event) => {
            if (!confirmClose()) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!confirmClose()) event.preventDefault();
          }}
          className={cn(
            "!fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] w-full flex-col rounded-t-2xl border border-border bg-card text-card-foreground shadow-xl focus:outline-none md:inset-y-0 md:right-0 md:left-auto md:max-h-screen md:w-[30rem] md:rounded-none md:border-l md:border-t-0",
            className,
          )}
          data-testid="ui-drawer"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-4 md:px-5">
            <SheetTitle className="text-lg font-semibold text-foreground">{title}</SheetTitle>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              aria-label={closeLabel}
              onClick={requestClose}
              data-testid="ui-drawer-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5", bodyClassName)} data-testid="ui-drawer-body">
            {children}
          </div>

          {footer ? (
            <div className="sticky bottom-0 z-10 border-t border-border bg-card px-4 py-4 md:px-5">
              {footer}
            </div>
          ) : null}
        </SheetPrimitive.Content>
      </SheetPortal>
    </Sheet>
  );
}
