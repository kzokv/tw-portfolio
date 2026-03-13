"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";

interface SettingsDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dict: AppDictionary;
  children: ReactNode;
}

export function SettingsDrawerShell({ open, onOpenChange, dict, children }: SettingsDrawerShellProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/28 backdrop-blur-sm data-[state=open]:animate-fade-in-up" />
        <Dialog.Content
          className="glass-panel !fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col rounded-none border-l border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,248,255,0.96))] p-4 shadow-[0_28px_80px_rgba(15,23,42,0.18)] focus:outline-none md:max-w-[46rem] md:p-5 lg:max-w-[52rem] xl:max-w-[54rem] xl:p-6"
          data-testid="settings-drawer"
        >
          <div className="mb-4 flex min-w-0 items-start justify-between gap-2 md:mb-5">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-semibold text-slate-950 md:text-2xl xl:text-3xl">{dict.settings.title}</Dialog.Title>
              <Dialog.Description className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600 md:mt-2">
                {dict.settings.description}
              </Dialog.Description>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              aria-label={dict.settings.closeDrawerAriaLabel}
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
