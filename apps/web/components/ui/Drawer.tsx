"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

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
    <Dialog.Root open={open} onOpenChange={(next) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      requestClose();
    }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/38 backdrop-blur-sm data-[state=open]:animate-fade-in-up" />
        <Dialog.Content
          aria-describedby={undefined}
          aria-modal="true"
          onEscapeKeyDown={(event) => {
            if (!confirmClose()) {
              event.preventDefault();
            }
          }}
          onPointerDownOutside={(event) => {
            if (!confirmClose()) {
              event.preventDefault();
            }
          }}
          className={cn(
            "glass-panel !fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] w-full flex-col rounded-t-[32px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(244,248,255,0.96))] shadow-[0_28px_80px_rgba(15,23,42,0.18)] focus:outline-none md:inset-y-0 md:right-0 md:left-auto md:max-h-screen md:w-[30rem] md:rounded-none md:border-l md:border-t-0",
            className,
          )}
          data-testid="ui-drawer"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] px-4 py-4 md:px-5">
            <Dialog.Title className="text-lg font-semibold text-slate-950">
              {title}
            </Dialog.Title>
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
            <div className="sticky bottom-0 z-10 border-t border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.99))] px-4 py-4 md:px-5">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
