---
name: CLI prompt UX preferences
description: User's preferences for @inquirer/prompts behavior — loop navigation, pagination, search
type: feedback
---

Always set `loop: false` on all `checkbox` and `select` prompts. Use dynamic `pageSize` based on terminal height.

**Why:** The default wrap-around / loop behavior in @inquirer/prompts (hitting ↓ at the bottom jumps to the top) is unwanted. User finds it disorienting during navigation of long key lists.

**How to apply:** Any time `checkbox` or `select` from `@inquirer/prompts` is used in this project, add these options:

```ts
// For checkbox (target selection, key selection):
{
  loop: false,
  pageSize: getPageSize(),  // Math.max(10, (process.stdout.rows ?? 24) - 4)
}

// For select (2-item lists like merge strategy):
{
  loop: false,
  // pageSize not needed for very short lists
}
```

The `getPageSize()` helper:
```ts
function getPageSize(): number {
  return Math.max(10, (process.stdout.rows ?? 24) - 4);
}
```

Minimum 10 rows, fallback 20 when stdout.rows is undefined (piped/non-TTY). The -4 reserves space for prompt chrome (message, help text, status line).

**Search/filter:** User does NOT want type-to-filter search on prompts. Pagination only.

**"Loop navigation" ambiguity:** When user said "do not use loop navigation", they meant the visual wrap-around in prompt lists — NOT for-loops in code. Clarify this distinction before refactoring code loops.
