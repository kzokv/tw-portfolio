# shadcn Breadcrumb: Item + Separator Must Be Siblings, Not Nested

`<BreadcrumbSeparator>` is itself an `<li role="presentation">`. Rendering it INSIDE a `<BreadcrumbItem>` (also `<li>`) nests `<li>` inside `<li>` — invalid HTML that triggers a Next.js / React hydration error: `In HTML, <li> cannot be a descendant of <li>`.

## The contract

`<BreadcrumbList>` (`<ol>`) holds both items and separators as **direct siblings**:

```tsx
<BreadcrumbList>           {/* <ol> */}
  <BreadcrumbItem>...</BreadcrumbItem>   {/* <li> */}
  <BreadcrumbSeparator />                {/* <li role="presentation"> */}
  <BreadcrumbItem>...</BreadcrumbItem>   {/* <li> */}
</BreadcrumbList>
```

When mapping over items, wrap each `(Item, Separator)` pair in a React `<Fragment>`:

```tsx
{items.map((item, i) => {
  const isLast = i === items.length - 1;
  return (
    <Fragment key={item.id}>
      <BreadcrumbItem>...</BreadcrumbItem>
      {!isLast ? <BreadcrumbSeparator /> : null}
    </Fragment>
  );
})}
```

## Wrong pattern (causes hydration error)

```tsx
{items.map((item, i) => (
  <BreadcrumbItem key={item.id}>
    {item.label}
    {!isLast ? <BreadcrumbSeparator /> : null}   {/* ❌ <li> inside <li> */}
  </BreadcrumbItem>
))}
```

## Why this is a rule

ui-reshape-shadcn Phase 3 introduced `apps/web/components/layout/Breadcrumb.tsx` with the separator nested inside each item. The hydration error surfaced when an admin user navigated to `/admin/*` — two console errors per render (`<li> cannot be a descendant of <li>` + `<li> cannot contain a nested <li>`). The fix was structural: convert each item rendering to a `<Fragment>` containing item-then-separator-as-siblings.

## How to apply

Any consumer of shadcn's `Breadcrumb` primitive in this repo: `<BreadcrumbItem>` and `<BreadcrumbSeparator>` are siblings under `<BreadcrumbList>`, never parent-child. Same rule extends to any future shadcn component family where multiple sub-components emit `<li>` (currently only Breadcrumb).

Canonical reference: `apps/web/components/layout/Breadcrumb.tsx`.
