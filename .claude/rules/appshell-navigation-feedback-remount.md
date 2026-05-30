# AppShell Navigation Feedback Must Survive Route Remounts

When route-transition feedback is owned by `AppShell`, remember that this app renders `AppShell` inside page components. A navigation from one shell-wrapped page to another can unmount the entire shell tree before the destination settles.

If pending UI state lives only in React state inside that shell tree, fast or server-rendered navigations can erase the feedback before the user sees it. The route can then appear to do nothing, or E2E assertions can miss the feedback even though `startNavigation()` fired.

## Pattern

For shell-owned navigation feedback:

- Start pending feedback before `router.push()` or link navigation when the destination pathname differs from the current pathname.
- Mirror the pending destination and label outside the shell component tree, such as `sessionStorage`, so the destination shell can restore it after remount.
- Keep a minimum visible duration so very fast navigations still produce perceptible feedback.
- Keep a maximum pending timeout so failed or same-path navigations cannot leave the content permanently dimmed.
- Clear the mirrored state when the route settles or the timeout expires.

## Example Shape

```tsx
const MIN_VISIBLE_MS = 350;
const MAX_PENDING_MS = 8_000;

function startNavigation({ href, label }: { href: string; label: string }) {
  const nextPath = new URL(href, window.location.href).pathname;
  if (nextPath === currentPathname) return;

  setPending({ href: nextPath, label, startedAt: performance.now() });
  sessionStorage.setItem("pendingNavigation", JSON.stringify({
    href: nextPath,
    label,
    createdAt: Date.now(),
  }));
}
```

On mount, read the stored value only if it targets the current pathname and is still younger than `MAX_PENDING_MS`; then show it for at least `MIN_VISIBLE_MS`.

## E2E Implication

Tests that assert navigation feedback should click the nav control and assert the pending label before waiting for app-ready markers. Helper methods that click a shell nav item must not immediately wait for the destination readiness marker if the test needs to observe the transient pending state.

## How To Apply

Use this rule when adding route feedback, dimming, progress banners, or other transient shell UI for `apps/web` page transitions. Do not assume `AppShell` is a persistent root unless it is moved above page-level route boundaries.

**Why:** During the UI gap refactor after the shadcn reshape, `NavigationFeedbackContext` initially kept pending state only inside `AppShell`. The destination page remounted a fresh shell, so Playwright missed the pending label on fast navigations. Mirroring the pending destination in `sessionStorage`, restoring it on the destination route, and capping it with an 8-second timeout made the UX observable without risking stuck dimming.
