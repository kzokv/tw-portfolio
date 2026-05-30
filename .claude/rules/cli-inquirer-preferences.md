# CLI UX Preferences for @inquirer/prompts

When using `@inquirer/prompts` in CLI tools (env-setup, future CLIs), always apply these UX preferences:

**Required options:**
```ts
import { checkbox, select } from "@inquirer/prompts";

// For checkbox prompts (key selection, target selection):
const selected = await checkbox({
  message: "Select items:",
  choices: items,
  loop: false,                    // No wrap-around navigation
  pageSize: getPageSize(),        // Dynamic pagination
});

// For select prompts (small lists like merge strategy):
const choice = await select({
  message: "Choose one:",
  choices: options,
  loop: false,                    // No wrap-around
});

// Helper for dynamic page size:
function getPageSize(): number {
  return Math.max(10, (process.stdout.rows ?? 24) - 4);
}
```

**Preferences:**
- `loop: false` on all `checkbox` and `select` — disables wrap-around (hitting ↓ at bottom jumps to top)
- `pageSize` dynamic based on terminal height — reserves space for prompt chrome
- No search/filter enabled — pagination only
- Minimum 10 rows, fallback 20 when stdout.rows is undefined (piped/non-TTY)

**Why:** User finds default wrap-around navigation disorienting during long key list navigation. Dynamic pagination prevents overflow in terminal height constraints.

**How to apply:**
- Any new CLI prompt in env-setup or future CLI tools must use these options
- Audit existing prompts and apply consistently
- Do NOT interpret "no loop navigation" as "no for-loops in code" — clarify the UX meaning first

**Common mistake:**
"Loop navigation" refers to the visual wrap-around in prompt lists, NOT code loops. Confirm user intent before refactoring any code loops.
