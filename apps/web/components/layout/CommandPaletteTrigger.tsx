"use client";

import { Search } from "lucide-react";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";
import { useCommandPaletteContext, useHasCommandPalette } from "./CommandPaletteContext";
import { getLayoutShellLabels, layoutI18n } from "./i18n";

const DEFAULT_LABEL = layoutI18n.en.commandPalette.placeholder;
const DEFAULT_ARIA_LABEL = getLayoutShellLabels("en").commandPaletteTrigger.ariaLabel;

interface CommandPaletteTriggerProps {
  className?: string;
  /** Override the placeholder text rendered inside the trigger. */
  label?: string;
  ariaLabel?: string;
}

/**
 * Phase 3e — TopBar "⌘K" trigger. Opens the global `<CommandPalette>` via
 * `CommandPaletteContext`. The keyboard `⌘K` / `Ctrl+K` binding lives in
 * `useCommandPalette`; this button is the discoverable click-affordance.
 *
 * Locked testid: `topbar-command-trigger` (spec §4).
 */
export function CommandPaletteTrigger({
  className,
  label = DEFAULT_LABEL,
  ariaLabel = DEFAULT_ARIA_LABEL,
}: CommandPaletteTriggerProps) {
  const hasPalette = useHasCommandPalette();
  const { setOpen } = useCommandPaletteContext();
  if (!hasPalette) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn(
        // Below `md` the inline search is the primary discovery surface; the
        // palette trigger is reduced to an icon-only square. At `md+` it
        // expands to a pill with the placeholder text and a `⌘K` kbd hint.
        "hidden h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-card text-xs text-muted-foreground shadow-sm md:inline-flex",
        // Icon-only square at md (no label, no kbd) — saves ~150px so the
        // breadcrumb keeps space when the desktop sidebar is open. Pill form
        // returns at `lg`+ where viewport budget permits.
        "h-9 w-9 px-0",
        "lg:w-auto lg:px-3",
        className,
      )}
      onClick={() => setOpen(true)}
      data-testid="topbar-command-trigger"
      aria-label={ariaLabel}
    >
      <Search className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden lg:inline">{label}</span>
      <kbd className="ml-2 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline">
        ⌘K
      </kbd>
    </Button>
  );
}
