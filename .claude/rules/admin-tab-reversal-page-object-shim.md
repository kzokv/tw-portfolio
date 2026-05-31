# Tab-Reversal Page-Object Shim: Gate Both Assert AND Action Helpers

When reversing an "outside-tabs is correct" framing — moving a `<Card>` from outside `<TabsRoot>` into a new `<TabsContent>` — page-object helpers that read or write through the section's root testid will silently operate on a hidden panel unless the correct tab is active. The fix requires **two** surfaces, not one.

## The mechanics

`@radix-ui/react-tabs` (project's `apps/web/components/ui/Tabs.tsx`) uses `forceMount` on `TabsContent`, so every panel stays in the DOM regardless of which tab is active. Inactive panels carry `data-state="inactive"` plus the HTML `hidden` attribute. Consequences:

- `document.querySelector("[data-testid='X']")` finds the element even on an inactive tab (unit tests stay green without a tab-click).
- Playwright `toBeVisible()` correctly reports `false` for elements inside an inactive panel.
- Playwright `.click()`, `.fill()`, `.type()`, `.drag()` operate on the hidden element without throwing — the user-perceived behavior is "nothing happens," but no error fires. This is the silent-failure trap.

## The rule

When a `<Card>` is moved into a `<TabsContent>` block, both files in the page-object pair must be updated:

1. **`*Actions.ts`** (the helper that owns the tab-trigger click). Add a public or private `ensureXTabActive(slug)` method (use a public `navigateToAdminSettingsTab(slug)` alias if other callers may need it). The method:
   - Reads the current `?tab=` URL param or the trigger's `data-state="active"` attribute.
   - Clicks `admin-settings-tab-{slug}` only if not already active.
   - Is **idempotent** — safe to call from every action helper without conditionals at call sites.

2. **`*Assert.ts`** (assertion helpers reading through the moved section's scope). Add a private `ensureXTabActive()` that delegates to the actions assistant's method, and call it at the top of EVERY assertion helper that reads through the section's testid scope.

Both surfaces are required. **Assert-side gating alone is insufficient** because action helpers execute BEFORE assert helpers read, and clicking/filling a hidden element produces silent no-ops, not visible errors.

```ts
// AppShellActions.ts (the canonical implementation, admin-ui-bugs 2026-05-12)
async ensureAdminSettingsTabActive(slug: AdminSettingsTabSlug): Promise<void> {
  const trigger = this.el.testId(`admin-settings-tab-${slug}`);
  if ((await trigger.getAttribute("data-state")) === "active") return;
  await trigger.click();
  await this.el.testId(`admin-settings-panel-${slug}`).waitFor({ state: "visible" });
}

async navigateToAdminSettingsTab(slug: AdminSettingsTabSlug): Promise<void> {
  // Public alias — also used by specs that explicitly drive tab navigation.
  await this.ensureAdminSettingsTabActive(slug);
}

// every action helper that touches the moved section:
async fillAdminTimeframeAddInput(value: string): Promise<void> {
  await this.ensureAdminSettingsTabActive("display-defaults");
  await this.el.testId("timeframe-add-input").fill(value);
}
```

```ts
// AppShellAssert.ts (admin-ui-bugs 2026-05-12)
private async ensureDisplayDefaultsTabActive(): Promise<void> {
  await this.actions.ensureAdminSettingsTabActive("display-defaults");
}

@Step()
async adminTimeframeSectionIsVisible(): Promise<void> {
  await this.ensureDisplayDefaultsTabActive();
  await expect(this.el.testId("timeframe-defaults-section")).toBeVisible();
}
```

## Symptoms when the gate is missing on one surface

- Suite-7 produces failures on `fill()` / `click()` / `drag()` calls that previously worked. The element is in the DOM (Playwright doesn't error on "missing element") but it's inside `hidden`. The locator timeout fires at the first downstream `toBeVisible()` assertion, not at the action site, making the root cause non-obvious.
- Sibling tests that only ASSERT (no actions) keep passing because their gate fires.
- Unit tests stay green (jsdom doesn't honor `hidden` for `querySelector`).

## Caller-spec impact

Done correctly, the gate is transparent. Existing spec files calling `appShell.actions.fillAdminTimeframeAddInput(...)` or `appShell.assert.adminTimeframeChipIsActive(...)` need **zero** changes. The gate fires inside the assistant; the spec never sees it.

If you find yourself adding `await appShell.actions.navigateToAdminSettingsTab(...)` to existing caller specs, the gate is in the wrong place — push it down into the assistant.

## Indentation reminder

When you move a `<Card>` into a `<TabsContent>` wrapper, the children of the card body need a +2 (or +4) space re-indent to match the new nesting depth. Pre-existing 8-space `<div>` inside a now-10-space `<Card>` looks broken in diff review and the Code Reviewer will catch it. Apply the re-indent in the same PR, not as a follow-up.

## Why this is a rule

**KZO-199** decided "Dashboard Timeframe Defaults and Provider API keys are whole-page concerns; keep them outside the tabs." The **admin-ui-bugs PR (2026-05-12)** reversed that decision after user feedback. The Implementer's first pass added the gate to `*Assert.ts` only; Suite 7 produced 5 failures from action helpers that bypassed the gate. The Architect's second pass added the symmetric gate to `*Actions.ts`. The 5-failure cost is what this rule prevents from repeating.

## How to apply

- Apply whenever any section moves from outside `<TabsRoot>` into a new `<TabsContent>`, on any page in the project.
- Pre-PR check: grep both `*Actions.ts` and `*Assert.ts` for every method that touches the moved section's testid scope. Every match needs the `ensureXTabActive()` call.
- Code Reviewer checklist item for any PR that adds a new `<TabsContent>` in `apps/web/components/admin/` or similar: verify both surfaces are gated.
- Companion rules: `responsive-dual-layout-testid-prefixes.md` (the broader "every dual-layout component needs symmetric updates" principle), `playwright-page-object-testid-drift.md` (the broader "page-object locators must match component testids" principle).
