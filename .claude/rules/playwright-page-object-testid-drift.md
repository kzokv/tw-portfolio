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
