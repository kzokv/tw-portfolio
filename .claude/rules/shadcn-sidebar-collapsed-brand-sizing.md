# shadcn Sidebar: Brand Header Must Match SidebarMenuButton's Collapsed-Icon Pattern

When the shadcn `<Sidebar collapsible="icon">` collapses, its rail width becomes `--sidebar-width-icon` (default `3rem` = 48px). Any custom element rendered inside `<SidebarHeader>` (e.g. brand badge + product name) MUST follow the same collapsed-mode sizing rules as `SidebarMenuButton`, or its content overflows the 48px rail and gets clipped by `overflow-hidden`.

## The contract (mirror SidebarMenuButton)

`SidebarMenuButton` applies these collapsed-mode rules:

```
group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2
```

→ 32×32 box with 8px padding around an inner `size-4` icon, fits inside the 48px rail with 8px breathing room each side.

Brand headers must apply the equivalent:

```tsx
<Link
  className={cn(
    "flex items-center gap-3 rounded-lg px-2 py-2 ...",
    "group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0",
    "group-data-[collapsible=icon]:justify-center",
  )}
>
  <span
    className={cn(
      "flex shrink-0 items-center justify-center rounded-lg ...",
      // Expanded: 36px. Collapsed: 28px to fit inside the 32px parent square.
      "h-9 w-9 group-data-[collapsible=icon]:h-7 group-data-[collapsible=icon]:w-7",
      "text-sm group-data-[collapsible=icon]:text-xs",
    )}
  >
    {brandLetter}
  </span>
  <span className="... group-data-[collapsible=icon]:hidden">
    {productName}
  </span>
</Link>
```

## Symptoms when violated

- Brand badge's right edge clipped by ~4–8 px when sidebar is collapsed.
- Hover affordance extends past the visible rail.
- Visual rhythm broken — brand sits at a different scale than nav items below it.

Math: `px-2` (16px total horizontal padding) + `w-9` (36px badge) = 52px content stuffed into 48px rail.

## Why this is a rule

ui-reshape-shadcn Phase 3c shipped `AppSidebar.tsx` with a brand `<Link>` using fixed `px-2 py-2` + `h-9 w-9 shrink-0` badge. When the sidebar collapsed, the badge clipped against the rail edge. Fix: apply the `SidebarMenuButton` collapsed-mode pattern verbatim — `!size-8 !p-0 justify-center` on the link, badge shrinks to `h-7 w-7` in the collapsed state.

## How to apply

Any custom non-`SidebarMenuButton` element rendered inside `<SidebarHeader>` (brand badges, switcher slots, custom triggers) must:

1. Shrink the outer element to `!size-8 !p-0` (or smaller) when `group-data-[collapsible=icon]`.
2. Shrink the inner content to fit inside that 32px square (badges ≤ `h-7 w-7`, icons ≤ `size-4`).
3. Hide text/secondary content with `group-data-[collapsible=icon]:hidden`.

Pre-PR check for any new `<SidebarHeader>` child: does it have `group-data-[collapsible=icon]:` rules? If not, it WILL clip at the 48px collapsed width.

Canonical reference: brand link in `apps/web/components/layout/AppSidebar.tsx`.
