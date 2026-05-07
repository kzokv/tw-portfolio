# Responsive Dual-Layout: Distinct Testid Prefixes for Table + Card Variants

When a component renders the same semantic elements in both a desktop table row AND a mobile card (toggled via Tailwind `hidden lg:block` / `lg:hidden` or equivalent), the card variant MUST use distinct `data-testid` values — not the same testids as the table row.

## Why

Both DOM trees exist simultaneously. Only the CSS `display` property differs. Playwright's `.click()`, `.fill()`, `.isDisabled()`, and any locator passed to `expect()` operate in strict mode: they throw `Error: strict mode violation` when a locator matches more than one element, even if one element is visually hidden. There is no "visible only" implicit filter on strict-mode element actions.

```ts
// ❌ Strict-mode failure — both ProviderRow and ProviderCard render this testid
await page.getByTestId("provider-rerun-btn-finmind-tw").click();
// → strict mode violation: getByTestId("provider-rerun-btn-finmind-tw") resolved to 2 elements

// ✅ Explicit prefix — unambiguous
await page.getByTestId("provider-rerun-btn-card-finmind-tw").click();
```

## Pattern — `testIdPrefix` prop on shared sub-components

When the same sub-component (`StatusBadge`, `ErrorTrail`, or similar) is rendered in both the table and card contexts, accept an optional `testIdPrefix` prop with a table-appropriate default:

```tsx
function StatusBadge({
  status,
  providerId,
  testIdPrefix = "provider-status-badge",   // table default
}: {
  status: ProviderHealthStatus;
  providerId: string;
  testIdPrefix?: string;
}) {
  return (
    <span data-testid={`${testIdPrefix}-${providerId}`} ...>
      ...
    </span>
  );
}

// In ProviderRow (table):
<StatusBadge status={...} providerId={...} />
// → data-testid="provider-status-badge-finmind-tw"

// In ProviderCard (mobile card):
<StatusBadge status={...} providerId={...} testIdPrefix="provider-status-badge-card" />
// → data-testid="provider-status-badge-card-finmind-tw"
```

Naming convention: suffix the card variant testid with `-card-` before the dynamic identifier segment, e.g.:
- `provider-row-{id}` → `provider-card-{id}` (article element)
- `provider-rerun-btn-{id}` → `provider-rerun-btn-card-{id}`
- `provider-errors-toggle-{id}` → `provider-errors-toggle-card-{id}`
- `provider-status-badge-{id}` → `provider-status-badge-card-{id}`
- `provider-error-trail-{id}` → `provider-error-trail-card-{id}`

## Page-object implication

Page objects that drive these dual-layout components should locate using the table testids by default (Playwright default viewport 1280px → `lg:block` table is visible) and document the card testid variants for viewport-override tests.

## Why this is a rule

Caught during KZO-177 when `ProviderCard` was introduced for the responsive mobile layout. The card re-used `provider-rerun-btn-${id}` and other table testids. Suite 7 (`test:e2e:oauth:mem`) failed on `.click()` with a strict-mode violation before the fix was applied. The issue is invisible to typecheck and unit tests — it only surfaces in real browser automation.

**How to apply:** Any time a component has a desktop-table-row + mobile-card dual layout sharing semantic child elements. Before marking implementation complete, grep for the table's testid values and confirm they do not appear in the card render. Code Reviewer should check both `ProviderRow` and `ProviderCard` (or equivalent) testids when reviewing responsive layout changes.
