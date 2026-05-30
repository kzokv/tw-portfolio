# Phased Ticket Decomposition: Assign the Config → Render Glue Slice

When decomposing a feature across sequential tickets — where Ticket A ships the config surface (admin UI, backend honoring config) and Ticket A' ships deeper customization UI later — the scope-todo must **explicitly assign the "config → render" glue slice**. Default: it goes to the ticket that ships the config UI, not the ticket that ships deeper customization.

Without an explicit assignment, the slice falls into a gray zone and each ticket assumes the other owns it. The earliest ticket ends up functional in name only — admin can save config, backend honors it, but the render surface still reads hardcoded defaults. Standalone deployment is a time-bomb.

## The pattern that breaks

```
Ticket A (158A): admin config UI + backend dynamic validation
Ticket A' (158C): user customization UI (blocked on A merging)

Gray slice (neither ticket claims):
  AppShell reads effective-config from DTO and renders accordingly
```

Result: A ships, admin sets non-default config, backend accepts the config, but AppShell still initializes from `DEFAULT_CONFIG` → 400 on every user action → broken.

## The rule

In every phased decomposition's scope-todo:

1. Draw the full data-flow path from config authoring → persisted storage → render.
2. For every edge in that path, name the ticket that implements it.
3. If any edge is "implicit" or "will be covered by the later ticket," **reassign it to the earlier ticket**. The earlier ticket must be standalone-deployable — admin config must be observable on the primary render surface on the day Ticket A ships, even if deeper customization arrives later.

## Why

KZO-159 (158A) CR iter 2 HIGH-1 finding. The scope-todo split 158A from 158C cleanly on the backend side (158A owns `user_preferences` + admin config; 158C owns user customization UI), but left `AppShell.tsx:1047` + `PortfolioTrendCard.tsx:17` in a gray zone. Both still read `DEFAULT_DASHBOARD_PERFORMANCE_RANGES` directly. Non-default admin config would have broken every button click in a standalone-158A deployment.

Architect authorized a scope expansion during Phase 4: minimal frontend wiring (read effective-ranges from the DTO, fallback to default on miss) landed in 158A to preserve standalone-deployability. 158C's user customization UI still adds cleanly on top because the 3-tier resolver (user → admin → default) handles the new consumer without conflict. But catching it in Phase 4 cost a convergence iteration. Doing the decomposition check at scope-grill time would have caught it for free.

## How to apply

- Apply during `/scope-grill` sessions when decomposing a multi-ticket feature. Add a "config → render path" walkthrough as a required step.
- Apply during code review of the first ticket in a sequence: verify the primary render surface consumes the new config shape, not a hardcoded default.
- Cross-reference `.claude/rules/team-phase-3-triage.md` (routing mechanics). This rule covers the **decomposition** side; triage covers the **routing** side.
- Doesn't apply to single-ticket features, obviously.

## Complementary heuristic: standalone-deployability check

For any phased feature, ask: "If we ship Ticket A today and Tickets A', A'' slip by a quarter, does the admin/user experience work?" If the answer is "admin can configure but nothing visibly changes," the glue slice is missing.
