---
name: project_command_palette_initial_query
description: Command palette's global ⌘K shortcut must clear initialQuery on every open, otherwise a stale carried query from a prior openWithQuery() leaks into the next palette session
type: project
---

# Command palette — clear `initialQuery` on every global open

`useCommandPalette` exposes two distinct open paths:

- `setOpen(true)` / global `⌘K` keydown handler → opens with a blank query
- `openWithQuery(query)` → opens with a pre-filled query (used by the inline `TopBarSearch` → ⌘K handoff per Phase 3e §22)

If the global `⌘K` handler toggles `open` without clearing `initialQuery`, a palette previously opened via `openWithQuery()` and then closed can re-open via `⌘K` with the stale carried query still populated. Symptom: user types nothing, presses ⌘K, sees the palette pre-filled with the last inline-search text.

## The fix (already applied 2026-05-17)

```ts
useEffect(() => {
  function onKeyDown(event: KeyboardEvent) {
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
```

`close()` already clears `initialQuery` correctly — the bug was only on the global toggle path.

## Generalization

This is an instance of a broader pattern: **any modal/dialog/popover with a controlled input that can be opened via two paths (one with pre-fill, one without) must reset the controlled input value on the without-pre-fill path.** Otherwise the pre-fill leaks across opens.

Candidate sites to audit (no 2nd data point yet — kept in memory until one lands):

- Recompute confirm dialog (`RecomputeConfirmDialog`) — currently has no controlled input
- Add transaction dialog — controlled by `draftTransaction` state, which is intentionally persistent (draft buffer)
- Repair modal in `/settings/tickers` — date inputs, controlled per-session
- Any future search-prefilled dialog opened from both the topbar and elsewhere

**Why:** Codex review of the post-Phase-3d UI sweep (2026-05-17) flagged `useCommandPalette.ts:37` as MEDIUM — the global ⌘K shortcut toggled `open` without resetting `initialQuery`. Fix landed in the same review-fix pass.

**How to apply:** When designing any controlled-input modal with two open paths, treat the "open blank" path as MUST RESET. Document the reset in the hook's comment. Memory entry until 2nd data point.

**Promotion gate:** If a second controlled-input dialog ships this pattern (or fails to), promote to `.claude/rules/controlled-input-dual-open-paths-reset.md`.
