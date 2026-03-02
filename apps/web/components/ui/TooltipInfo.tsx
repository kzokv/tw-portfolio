"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { CircleHelp } from "lucide-react";

interface TooltipInfoProps {
  label: string;
  content: string;
  triggerTestId?: string;
  contentTestId?: string;
}

export function TooltipInfo({ label, content, triggerTestId, contentTestId }: TooltipInfoProps) {
  return (
    <Tooltip.Provider delayDuration={180}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(109,94,252,0.6)]"
            data-testid={triggerTestId}
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className="glass-panel z-[60] max-w-xs break-words rounded-2xl px-3 py-2 text-xs leading-5 text-slate-100 shadow-glass"
            data-testid={contentTestId}
          >
            {content}
            <Tooltip.Arrow className="fill-slate-900/90" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
