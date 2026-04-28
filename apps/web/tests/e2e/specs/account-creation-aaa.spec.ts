/**
 * KZO-179 — Golden-path E2E for multi-account creation UX.
 *
 * One spec per scope-todo D8. Edge cases (duplicate-name 409, validation
 * rejections, picker conditional render, error rendering) are covered in
 * suites 3 / 5 / 8 — NOT here.
 *
 * Flow: dev_bypass user, default `Main` account already seeded → open
 * settings drawer → Accounts tab → fill `name=USD Brokerage` / type=Bank /
 * currency=USD → submit → assert drawer's Accounts tab list shows BOTH
 * accounts → close drawer → navigate `/cash-ledger` → confirm page renders
 * cleanly (filter toolbar + account select visible).
 *
 * Note re: scope-todo D8 dropdown chip expectation — Option B (architect-
 * approved during EXECUTE checkpoint). The cash-ledger account `<select>`
 * derives its named options from `summary.map(...)` (CashLedgerClient.tsx:197)
 * — only accounts with cash-ledger entries appear as filter options. A
 * freshly-created account with zero entries cannot appear in the dropdown
 * regardless of correctness of POST /accounts, AppShell.refreshAccounts,
 * or the chip mapping.
 *
 * Drawer-state assertion (both accounts visible in `AccountsListSection`
 * after submit) is the load-bearing E2E proof that POST → store update →
 * AppShell.dashboard.refresh → drawer re-render works end-to-end.
 * Cash-ledger assertion here is limited to filter-toolbar visibility —
 * "page renders cleanly post-create"; downstream consumer mount path
 * isn't broken. Drawer round-trip at the end re-validates persistence.
 *
 * Follow-up captured for Wave 2 transition note (architect direction):
 *   KZO-179 leaves the cash-ledger filter dropdown sourcing from the
 *   summary stream (only accounts with existing entries appear). A
 *   freshly-created account is reachable via the cash-ledger create-entry
 *   form (sources from `accountMeta` keys), but NOT via the filter
 *   dropdown until it has at least one entry. Intentional for filter UX
 *   ("filter what exists") but might surprise users on first cash-entry
 *   creation. When a primary "create new entry" CTA is added, ensure its
 *   account picker sources from `/accounts` (all accounts), not from
 *   `summary` (entries-having accounts). Tracked separately if it
 *   becomes a real UX issue.
 *
 * Adherence checklist:
 * - 2 workers parallel (project default per `e2e-aaa-guardrails.md`).
 * - Deterministic readiness via element waits (no `networkidle` per
 *   `playwright-navigation-patterns.md`).
 * - Bundle rebuild via `npm run test:e2e:bypass:mem --prefix apps/web` —
 *   `playwright-web-bundle-rebuild.md`.
 * - All assertions routed through Assert helpers (no raw `expect`) per
 *   AAA framework + `e2e-aaa-guardrails.md`.
 */

import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

test("[settings drawer]: create USD Brokerage → both accounts visible in drawer + cash-ledger renders cleanly", async ({
  appShell,
  settings,
  cashLedger,
}) => {
  // ── Arrange ───────────────────────────────────────────────────────────────
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();
  await settings.assert.accountCreateFormIsVisible();

  // Precondition: only the seeded "Main" account exists.
  await settings.assert.accountNameLabelCountIs(1);
  await settings.assert.accountNameLabelContains(/Main/i);

  // ── Act ───────────────────────────────────────────────────────────────────
  await settings.actions.fillAccountCreateName("USD Brokerage");
  await settings.actions.selectAccountCreateType("bank");
  await settings.actions.selectAccountCreateCurrency("USD");
  await settings.assert.accountCreatePreviewContains(/USD Brokerage/);
  await settings.assert.accountCreatePreviewContains(/USD/);
  await settings.assert.accountCreatePreviewContains(/Bank/i);

  await settings.actions.submitAccountCreate();

  // ── Assert (drawer) ───────────────────────────────────────────────────────
  // Form resets after submit (D12).
  await settings.assert.accountCreateNameInputIsEmpty();

  // The relocated AccountsListSection now shows both accounts.
  await settings.assert.accountNameLabelCountIs(2);
  // Order is insertion order (seeded Main first, USD Brokerage second).
  await settings.assert.accountNameLabelContains(/Main/i, 0);
  await settings.assert.accountNameLabelContains(/USD Brokerage/i, 1);

  // ── Act: close drawer + navigate to /cash-ledger ──────────────────────────
  await settings.actions.closeWithEscape();
  await settings.assert.drawerIsClosed();

  await appShell.actions.navigateToRoute("/cash-ledger");

  // ── Assert (cash-ledger renders cleanly post-create) ──────────────────────
  // Drawer-state assertions above already prove POST /accounts + form +
  // AppShell refresh wiring work end-to-end. Here we only verify the new
  // account did not break a downstream consumer's mount path.
  await cashLedger.assert.filterToolbarIsVisible();
  await cashLedger.assert.filterAccountSelectIsVisible();

  // ── Round-trip: re-open drawer, confirm new account persists ─────────────
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();
  await settings.assert.accountNameLabelCountIs(2);
  await settings.assert.accountNameLabelContains(/USD Brokerage/i, 1);
});
