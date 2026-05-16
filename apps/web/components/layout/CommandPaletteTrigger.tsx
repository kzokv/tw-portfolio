"use client";

import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";

interface CommandPaletteTriggerProps {
  className?: string;
  /** Override the placeholder text rendered inside the trigger. */
  label?: string;
}

/**
 * "⌘K" trigger placeholder for Phase 3c. The real `<CommandDialog>` ships in
 * Phase 3e (spec §3e). For now, clicking shows a Sonner toast hinting at the
 * upcoming feature so the affordance is discoverable without breaking E2E
 * waits.
 *
 * Locked testid: `topbar-command-trigger` (spec §4).
 */
export function CommandPaletteTrigger({ className, label = "Search anything…" }: CommandPaletteTriggerProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn(
        "hidden h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs text-muted-foreground shadow-sm md:inline-flex",
        className,
      )}
      onClick={() => {
        toast.info("Command palette coming in Phase 3e.");
      }}
      data-testid="topbar-command-trigger"
      aria-label="Open command palette"
    >
      <Search className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden md:inline">{label}</span>
      <kbd className="ml-2 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline">
        ⌘K
      </kbd>
    </Button>
  );
}
