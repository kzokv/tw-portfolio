# Playwright Page Object Testid Drift

Page-object locator strings and component `data-testid` attributes can silently diverge. A locator like `this.locate("catalog-live-searching")` compiles and loads cleanly but times out silently at runtime if the component renders `data-testid="catalog-live-loading"` instead.

**The danger:** unused locators don't fail tests — they fail test *authors* who write a spec using the locator months later and get a mysterious timeout with no pointer to the root cause.

## Grep recipe (pre-PR check for page-object changes)

When adding or renaming a locator in `libs/test-e2e/src/pages/**/*.ts`, grep the component source to verify the testid exists:

```bash
# Verify every new locator string has a matching data-testid in the app source
grep -rn 'data-testid="catalog-live-loading"' apps/web/
# → expect at least one match; zero matches = locator is wrong or testid was renamed
```

For a batch check across a whole page object file:
```bash
# Extract all locate("...") strings from a page object and grep each against apps/web/
grep -oE 'locate\("([^"]+)"' libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts \
  | sed 's/locate("//;s/"//' \
  | while read id; do
      count=$(grep -rl "data-testid=\"$id\"" apps/web/ | wc -l | tr -d ' ')
      echo "$count  $id"
    done \
  | sort -n
# Lines with 0 = testid drift candidates
```

## Code Reviewer checklist item

When reviewing any PR that adds or renames locators in `libs/test-e2e/src/pages/**`:
- Run the single-locator grep for each new `locate("…")` call site
- Flag count=0 as **MEDIUM** (latent bug; silent timeout for any future spec author)
- Flag count=0 on a locator already used in a spec as **HIGH** (active test failure risk)

## Automation follow-up (open)

A lint rule or `scripts/check-testid-coverage.ts` that runs as part of `npm run typecheck` or CI would catch this class of drift automatically. No ticket scoped yet — track here until then.

**Why:** KZO-188 Code Review Phase 3 caught `SettingsDrawerPage.ts:358` referencing `catalog-live-searching` while the component rendered `data-testid="catalog-live-loading"`. The locator was unreferenced in any spec at the time (MEDIUM — latent bug). The fix was 1 line but was only caught because the Code Reviewer explicitly checked the new page-object additions against the KZO-188 checklist. Without the checklist, the drift would have silently persisted until someone wrote a spec using the locator.

**How to apply:** Any time a page object (`libs/test-e2e/src/pages/**/*.ts`) gains a new `locate("…")` call. Run the single-locator grep before marking the PR ready. Add to Code Reviewer checklist for page-object PRs.

## Recurring trigger class: surface relocation / shadcn-migration / testid rename

The drift surfaces most often when a *component* moves or its testids are renamed while the *page object* is updated in a separate PR (or not at all). Three subclasses observed:

1. **Surface relocation.** A field/section moves between routes (e.g. KZO-188 moved cost-basis off `/settings/display`; the post-3d UI sweep moved Locale + Quote Poll from `/settings/display` to a new `/settings/general`). Page object locators continue to use the old route's section anchor or testid. Spec assertions that drove through the old anchor hang on hidden DOM.

2. **shadcn / primitive migration.** When a component switches from a custom shadcn-styled control to a shadcn primitive (or vice-versa), the testid often moves from a wrapper to an inner trigger (or the other way around). The post-3d UI sweep renamed `display-language-select` → `settings-locale-select` when moving the field to the new `/settings/general` route. The page-object kept the old string ("legacy alias") for 2 ticket cycles before drift was caught.

3. **Profile / data-shape rewrite.** Deleting a section deletes its testids; the page-object's locator entries become latent silent-timeout traps for any future spec author. The post-3d sweep removed `profile-display-name-edit-input` / `profile-picture-url-input` / `profile-confirm-dialog` / `profile-picture-confirm-dialog` from `ProfileSettingsClient` (the editable card was deleted, only `ProfileSection` kept). The matching locator entries lived on in `SettingsDrawerPage.ts` for ~1 week until a Codex review caught them.

**Audit recipe when relocating / renaming / deleting component surfaces:**

```bash
# 1. Find every testid the changed component USED to render
git diff <base>..HEAD -- 'apps/web/components/**/*.tsx' | grep -oE 'data-testid="[^"]+"' | sort -u

# 2. For every removed testid, confirm the page object doesn't still reference it
for tid in $(git diff <base>..HEAD -- 'apps/web/components/**/*.tsx' | grep -oE '^-.*data-testid="[^"]+"' | grep -oE '"[^"]+"'); do
  grep -rn "$tid" libs/test-e2e/src/ apps/web/tests/ && echo "STALE: $tid still referenced"
done

# 3. For every renamed testid, confirm both the page object and any spec were updated
```

**Companion to other rules:**
- `.claude/rules/responsive-dual-layout-testid-prefixes.md` — symmetric component-side discipline (don't reuse table testids in card variants)
- `.claude/rules/admin-tab-reversal-page-object-shim.md` — the page-object gating pattern when sections move into/out of `<TabsContent>`
- `.claude/rules/shared-types-barrel-turbopack.md` — typecheck doesn't catch this class either; only E2E does

**Pre-PR Code-Reviewer checklist additions:**

For any PR that (a) renames a `data-testid` value, (b) moves a section between routes, or (c) deletes a component subsection — verify every removed testid string is also removed from `libs/test-e2e/src/pages/**/*.ts` AND `libs/test-e2e/src/assistants/**/*.ts` (locator init blocks AND interface declarations).

The single-locator grep recipe above is the minimum; the audit recipe is the maximum. Default to the audit recipe for any PR touching shadcn-migration surfaces — historically the highest-density trigger.

**Why (2nd data point):** Post-Phase-3d UI bugfix sweep (2026-05-17) — Codex review caught 4 stale locator entries on `SettingsDrawerPage.ts:401-434` for testids deleted alongside the profile-editable-card removal and the locale-select rename. Component side had zero matching `data-testid` attributes in `apps/web`. Same failure mode as KZO-188 but triggered by a relocation+rename pair rather than a single rename. The 2nd data point confirms that any surface relocation OR primitive migration in the same PR family should trigger the audit recipe, not just the single-locator grep.
