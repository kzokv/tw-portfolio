// Phase 3d iter 2 — tooltips-a11y AAA spec rewrite (Code Reviewer H3 fix).
//
// Coverage retained after rewrite:
//   [tooltip-a11y-A] Locale tooltip in /settings/general remains keyboard-
//                    focus-reachable and its content surfaces when focused.
//   [tooltip-a11y-B] Transaction-form tooltip + TopBar avatar button stay
//                    focusable across shell chrome. Validates that the
//                    Phase 3c TopBar rewrite did not regress focus.
//
// Coverage intentionally dropped:
//   - The accounting-method tooltip assertions (feature retired per
//     scope-addendum A5).
//   - The "Unsaved changes" / discard-notice flow — drawer-only concept;
//     auto-save replaces it. SettingsAssert.closeWarningIsVisible() /
//     discardNoticeContains() are intentional no-ops in the assistant
//     (libs/test-e2e/src/assistants/settings/SettingsAssert.ts).
//
// Per `playwright-page-object-testid-drift.md`: locale tooltip testids
// (`tooltip-settings-locale-trigger`, `tooltip-settings-locale-content`)
// are added to `DisplaySettingsClient.tsx` by Frontend's §4.1 in this same
// iteration. If Frontend has not yet landed §4.1 when Suite 6 runs, the
// [tooltip-a11y-A] case is TDD-red — green follows automatically once the
// trigger element is in the DOM.
//
// Per `playwright-navigation-patterns.md`: route nav via the page-object's
// `navigateToRoute()` helper (uses `domcontentloaded` semantics; no SSE-vs-
// networkidle trap).

import { test } from "@vakwen/test-e2e/fixtures/appPages";

test("[tooltip-a11y-A] locale tooltip in /settings/general is keyboard-focus reachable", async ({
  appShell,
  settings,
}) => {
  await appShell.actions.navigateToRoute("/settings/general");

  // `focusLocaleTooltip()` implicitly gates on the trigger element being
  // attached, so an explicit section-visibility assertion is redundant.
  await settings.actions.focusLocaleTooltip();
  await settings.assert.localeTooltipContentIsVisible();
});

test("[tooltip-a11y-B] transaction tooltips and shell controls stay focusable", async ({
  appShell,
  transactions,
}) => {
  await transactions.actions.navigateToTransactions();

  await appShell.assert.desktopSearchIsVisible();
  await appShell.actions.focusAvatarButton();
  await appShell.assert.avatarButtonIsFocused();

  await transactions.actions.focusAccountTooltip();
  await transactions.assert.tooltipAccountContentIsVisible();
});
