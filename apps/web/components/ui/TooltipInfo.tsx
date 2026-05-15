"use client";

// Phase 1 adapter shim: preserves the bespoke `<TooltipInfo>` help-circle API
// while delegating Provider/Trigger/Content rendering to the shadcn Tooltip
// primitive at ./shadcn/tooltip. The CircleHelp icon and project-styled
// trigger button are owned here.

import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./shadcn/tooltip";

interface TooltipInfoProps {
  label: string;
  content: string;
  triggerTestId?: string;
  contentTestId?: string;
}

export function TooltipInfo({ label, content, triggerTestId, contentTestId }: TooltipInfoProps) {
  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={triggerTestId}
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6} data-testid={contentTestId}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
