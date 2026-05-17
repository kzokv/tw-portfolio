"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Phase 3e — global ⌘K / Ctrl+K binding + dialog open state for the
 * CommandPalette.
 *
 * The hook is intentionally tiny: it owns the boolean open state and
 * registers a single keydown listener that toggles the dialog. The dialog
 * itself (and the inline-search ↔ modal handoff per spec §22) consume
 * `open`, `setOpen`, and the optional `initialQuery` setter exposed below.
 *
 * Per `.claude/rules/react-useEventStream-preconnect-pattern.md` semantics
 * the listener is registered eagerly on mount so the global shortcut works
 * on every page that mounts AppShell (or AdminShell) — no per-route gating.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState("");

  const openWithQuery = useCallback((query: string) => {
    setInitialQuery(query);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // Clear the carried query so a subsequent ⌘K invocation starts blank.
    setInitialQuery("");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Match cmdk's documented binding so the shortcut is consistent with
      // shadcn examples. Lowercase comparison guards against shift state.
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        // Clear any stale carried query from a prior openWithQuery() call so
        // the global shortcut always opens with a blank input.
        setInitialQuery("");
        setOpen((previous) => !previous);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    open,
    setOpen,
    initialQuery,
    setInitialQuery,
    openWithQuery,
    close,
  };
}
