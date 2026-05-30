"use client";

// Phase 1 adapter shim: preserves the bespoke `<TooltipInfo>` help-circle API
// while delegating Provider/Trigger/Content rendering to the shadcn Tooltip
// primitive at ./shadcn/tooltip. The CircleHelp icon and project-styled
// trigger button are owned here.

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./shadcn/tooltip";

interface TooltipInfoProps {
  label: string;
  content: string;
  triggerTestId?: string;
  contentTestId?: string;
}

export function TooltipInfo({ label, content, triggerTestId, contentTestId }: TooltipInfoProps) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = focused || hovered;

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setFocused(false);
            setHovered(false);
          }
        }}
      >
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={triggerTestId}
            onBlur={() => setFocused(false)}
            onFocus={() => setFocused(true)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
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
