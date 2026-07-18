/**
 * KZO-183 — Per-account fee-profile lifecycle E2E (dev_bypass / MemoryPersistence).
 *
 * Covers F4 scope items:
 *   AFP-1  Accounts tab shows per-account expandable cards with profile selector scoped per account.
 *   AFP-2  Add fee profile to account A → save → reopen → profile persists on A only.
 *   AFP-5  "Duplicate from another account" deep-copies source account's profiles into A.
 *   AFP-6  Search filter highlights cards with matching profile names.
 *
 * Default seeded state (MemoryPersistence):
 *   - Account: { id: "acc-1", name: "Main", defaultCurrency: "TWD", accountType: "broker" }
 *   - Profile: { accountId: "acc-1", name: "Default Broker" }   (randomUUID id)
 *
 * Rules followed:
 *   - 2 workers parallel (project default, e2e-aaa-guardrails.md).
 *   - All assertions through Assert helpers (no raw expect in test body).
 *   - No networkidle (playwright-navigation-patterns.md).
 *   - Bundle rebuild via `npm run test:e2e:bypass:mem --prefix apps/web`.
 */

import { test } from "@vakwen/test-e2e/fixtures/appPages";

// ─── AFP-1 ────────────────────────────────────────────────────────────────────

test("[settings drawer]: Accounts tab shows expandable card per account with profile selector scoped to that account", async ({
  appShell,
  settings,
}) => {
  // ── Arrange ───────────────────────────────────────────────────────────────
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsSection("accounts");

  // ── Assert: exactly one card for the seeded "Main" account ────────────────
  await settings.assert.accountNameLabelCountIs(1);
  await settings.assert.accountNameLabelContains(/Main/i, 0);

  // ── Act: expand the card ──────────────────────────────────────────────────
  await settings.actions.expandAccountCard("acc-1");
  await settings.assert.accountCardIsExpanded("acc-1");

  // ── Assert: fee-profile selector is bound and non-empty ───────────────────
  // KZO-183 composite-FK invariant: the seeded account must reference a profile
  // owned by the same account. A non-empty selector value proves the wire-up.
  await settings.assert.accountFeeProfileSelectHasNonEmptyValue("acc-1");

  // Exactly one profile row visible inside acc-1's card.
  await settings.assert.accountProfileCountIs("acc-1", 1);
});

test("[settings drawer]: fee profile discount save → value persists after leaving and reopening Settings", async ({
  appShell,
  settings,
}) => {
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsSection("accounts");
  await settings.actions.expandAccountCard("acc-1");

  await settings.actions.editSelectedProfileDiscount("acc-1", "25");
  await appShell.actions.navigateToRoute("/dashboard");
  await appShell.actions.openSettingsSection("accounts");
  await settings.actions.expandAccountCard("acc-1");
  await settings.actions.openSelectedProfileEditor("acc-1");

  await settings.assert.selectedProfileDiscountValueIs("acc-1", "25");
});

// ─── AFP-2 ────────────────────────────────────────────────────────────────────

test("[settings drawer]: add fee profile to account A → save → profile persists on A only", async ({
  appShell,
  settings,
}) => {
  // ── Arrange ───────────────────────────────────────────────────────────────
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsSection("accounts");

  // Create a second account so cross-contamination assertions are meaningful.
  await settings.actions.fillAccountCreateName("Second Account");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");
  const secondResponse = await settings.actions.submitAccountCreate();
  const secondAccount = (await secondResponse.json()) as { id: string };

  // ── Act: expand acc-1, add a profile ────────────────────────────────────
  await settings.actions.expandAccountCard("acc-1");
  await settings.assert.accountProfileCountIs("acc-1", 1);

  await settings.actions.addFeeProfileToAccount("acc-1");
  await settings.assert.accountProfileCountIs("acc-1", 2);

  // ── Act: save + navigate away ─────────────────────────────────────────────
  // Phase 3d iter 2 — drawer-as-modal retired. We navigate to /dashboard
  // to leave /settings/* (so `drawerIsClosed` URL-based assertion passes),
  // then re-enter /settings/accounts to confirm persistence.
  await settings.actions.save();
  await appShell.actions.navigateToRoute("/dashboard");
  await settings.assert.drawerIsClosed();

  // ── Assert: reopen → acc-1 has 2 profiles, second account has 1 ──────────
  await appShell.actions.openSettingsSection("accounts");

  await settings.actions.expandAccountCard("acc-1");
  await settings.assert.accountProfileCountIs("acc-1", 2);

  await settings.actions.expandAccountCard(secondAccount.id);
  await settings.assert.accountProfileCountIs(secondAccount.id, 1);
});

// ─── AFP-5 ────────────────────────────────────────────────────────────────────

test("[settings drawer]: Duplicate from another account deep-copies source profiles into target account", async ({
  appShell,
  settings,
}) => {
  // ── Arrange: create account B ─────────────────────────────────────────────
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsSection("accounts");

  await settings.actions.fillAccountCreateName("Account B");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");
  const bResponse = await settings.actions.submitAccountCreate();
  const accountB = (await bResponse.json()) as { id: string; feeProfileId: string };

  // ── Precondition: acc-1 has 1 profile; account B has 1 profile ───────────
  await settings.actions.expandAccountCard("acc-1");
  await settings.assert.accountProfileCountIs("acc-1", 1);

  // ── Act: open the duplicate picker on acc-1 ───────────────────────────────
  await settings.actions.clickDuplicateFromAnotherAccount("acc-1");

  // Select account B as the source.
  await settings.actions.selectDuplicateSourceAccount(accountB.id);

  // Check account B's auto-seeded profile checkbox.
  await settings.actions.checkDuplicateProfile(accountB.feeProfileId);

  // Confirm — copies account B's profile into acc-1.
  await settings.actions.confirmDuplicate();

  // ── Assert: acc-1 now has 2 profiles ─────────────────────────────────────
  await settings.assert.accountProfileCountIs("acc-1", 2);

  // ── Act: save + navigate away ─────────────────────────────────────────────
  // Phase 3d iter 2 — see AFP-2 above for the route-mode close pattern.
  await settings.actions.save();
  await appShell.actions.navigateToRoute("/dashboard");
  await settings.assert.drawerIsClosed();

  // ── Assert: reopen → acc-1 has 2 profiles, account B still has 1 ─────────
  await appShell.actions.openSettingsSection("accounts");

  await settings.actions.expandAccountCard("acc-1");
  await settings.assert.accountProfileCountIs("acc-1", 2);

  await settings.actions.expandAccountCard(accountB.id);
  await settings.assert.accountProfileCountIs(accountB.id, 1);
});

// ─── AFP-6 ────────────────────────────────────────────────────────────────────

test("[settings drawer]: search filter expands cards with matching profile names and collapses misses", async ({
  appShell,
  settings,
}) => {
  // ── Arrange: create account B and give it a distinctive profile name ──────
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsSection("accounts");

  await settings.actions.fillAccountCreateName("Account B");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");
  const bResponse = await settings.actions.submitAccountCreate();
  const accountB = (await bResponse.json()) as { id: string; feeProfileId: string };

  // Expand account B and rename its auto-seeded profile to a unique string.
  await settings.actions.expandAccountCard(accountB.id);
  await settings.actions.editProfileName(accountB.feeProfileId, "B-Only Profile");

  // acc-1 still has "Default Broker" — does NOT contain "B-Only".

  // ── Act: search for the B-specific profile name ───────────────────────────
  await settings.actions.searchAccountsTab("B-Only");

  // ── Assert: account B expands (hit); acc-1 collapses (miss) ──────────────
  await settings.assert.accountCardIsExpanded(accountB.id);
  await settings.assert.accountCardIsCollapsed("acc-1");

  // ── Act: clear search ─────────────────────────────────────────────────────
  await settings.actions.clearAccountsTabSearch();

  // Both cards now revert to default collapsed state (empty search → all collapsed).
  await settings.assert.accountCardIsCollapsed("acc-1");
  await settings.assert.accountCardIsCollapsed(accountB.id);
});
