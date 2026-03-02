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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/82 data-[state=open]:animate-fade-in-up" />
        <Dialog.Content
          className="glass-panel !fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col rounded-none border-l border-white/10 p-4 shadow-glass focus:outline-none md:max-w-[46rem] md:p-5 lg:max-w-[52rem] xl:max-w-[54rem] xl:p-6"
          data-testid="settings-drawer"
        >
          <div className="mb-4 flex min-w-0 items-start justify-between gap-2 md:mb-5">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-semibold text-ink md:text-2xl xl:text-3xl">{dict.settings.title}</Dialog.Title>
              <Dialog.Description className="mt-1.5 max-w-xl text-sm leading-6 text-slate-300 md:mt-2">
                {dict.settings.description}
              </Dialog.Description>
            </div>
            <Button variant="ghost" size="sm" aria-label={dict.settings.closeDrawerAriaLabel} onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
