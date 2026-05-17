"use client";

import { createContext, useContext, type ReactNode } from "react";

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Open the palette with a pre-filled query (e.g. §22 inline-search → ⌘K handoff). */
  openWithQuery: (query: string) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

/** True when wrapped in a `<CommandPaletteProvider>`. Used by `CommandPaletteTrigger`
 *  to skip rendering on admin/auth shells that don't mount the palette. */
export function useHasCommandPalette(): boolean {
  return useContext(CommandPaletteContext) !== null;
}

/**
 * Phase 3e — shared dialog open-state for the ⌘K command palette.
 *
 * `<AppShell>` provides the state; the `<CommandPaletteTrigger>` (in TopBar)
 * and `<TopBarSearch>` (§22 inline-search ↔ modal handoff) consume it to
 * open the dialog from outside AppShell's render tree.
 *
 * Consumers in a tree without the provider get a no-op fallback so they
 * remain mountable in storybook / isolation tests.
 */
export function CommandPaletteProvider({
  value,
  children,
}: {
  value: CommandPaletteContextValue;
  children: ReactNode;
}) {
  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}

export function useCommandPaletteContext(): CommandPaletteContextValue {
  return useContext(CommandPaletteContext) ?? {
    open: false,
    setOpen: () => undefined,
    openWithQuery: () => undefined,
  };
}
