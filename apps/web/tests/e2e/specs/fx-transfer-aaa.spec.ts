/**
 * KZO-168 — FX-transfer end-to-end coverage.
 *
 * Reserved FX-rate fixture dates for this spec: 2026-04-01 (per scope-todo
 * D17 hygiene). Currency pair: TWD↔USD only.
 *
 * Scope:
 *   1. [create]: TWD→USD via the cash-ledger "New FX Transfer" dialog.
 *      Assert the paired legs render with the FX badges after submit.
 *   2. [validation]: an out-of-band rate keeps the submit button disabled
 *      after the estimate resolves.
 *
 * Adherence:
 * - 2 workers parallel (project default per `e2e-aaa-guardrails.md`).
 * - No `networkidle` (per `playwright-navigation-patterns.md`); deterministic
 *   element waits via assistant Assert helpers.
 * - Bundle rebuild via `npm run test:e2e:bypass:mem --prefix apps/web`
 *   (per `playwright-web-bundle-rebuild.md`).
 * - Assertions routed through assistant Assert helpers per AAA framework.
 */

import { test } from "@vakwen/test-e2e/fixtures/appPages";

const FX_DATE = "2026-04-01";

test.describe("FX transfer (KZO-168)", () => {
  test.beforeEach(async ({ fxTransfer }) => {
    await fxTransfer.arrange.seedFxRates([
      { date: FX_DATE, baseCurrency: "TWD", quoteCurrency: "USD", rate: 0.032 },
      { date: FX_DATE, baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.25 },
    ]);
  });

  test("[create]: TWD→USD via the modal posts paired legs and refreshes the ledger", async ({
    appShell,
    cashLedger,
    fxTransfer,
    settings,
    page,
  }) => {
    // ── Arrange: fund the seeded TWD wallet via a dividend posting (positive
    // TWD entry without requiring a prior position), then create a USD
    // account through the settings drawer.
    await fxTransfer.arrange.fundTwdViaDividend({
      paymentDate: "2026-03-30",
      amount: 5000,
    });

    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.actions.openSettingsDrawer();
    await settings.arrange.openAccountsTab();
    await settings.actions.fillAccountCreateName("KZO-168 USD Wallet");
    await settings.actions.selectAccountCreateType("bank");
    await settings.actions.selectAccountCreateCurrency("USD");
    const accountResponse = await settings.actions.submitAccountCreate();
    const newAccount = (await accountResponse.json()) as { id: string };
    await page.keyboard.press("Escape");

    // ── Act: open the FX-transfer dialog from the cash ledger ─────────────────
    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await fxTransfer.assert.newTransferButtonVisible();
    await fxTransfer.actions.openCreateDialog();
    await fxTransfer.assert.dialogVisible();

    await fxTransfer.actions.selectFromAccount("acc-1");
    await fxTransfer.actions.selectToAccount(newAccount.id);
    await fxTransfer.actions.fillFromAmount("1000");
    await fxTransfer.actions.fillToAmount("32");
    await fxTransfer.actions.fillRate("0.032");
    await fxTransfer.actions.fillEntryDate(FX_DATE);

    // Wait for the debounced estimate to resolve so the submit button enables.
    await fxTransfer.assert.submitEnabled(5000);
    await fxTransfer.actions.submit();

    // ── Assert: dialog dismisses + ledger now has the paired legs ─────────────
    await fxTransfer.assert.dialogHidden();
    await fxTransfer.assert.fxOutBadgeVisible(10000);
    await fxTransfer.assert.fxInBadgeVisible(10000);
  });

  test("[validation]: out-of-band rate keeps the submit button disabled after the estimate resolves", async ({
    appShell,
    cashLedger,
    fxTransfer,
    settings,
    page,
  }) => {
    await fxTransfer.arrange.fundTwdViaDividend({
      paymentDate: "2026-03-30",
      amount: 5000,
    });

    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.actions.openSettingsDrawer();
    await settings.arrange.openAccountsTab();
    await settings.actions.fillAccountCreateName("KZO-168 Validation USD");
    await settings.actions.selectAccountCreateType("bank");
    await settings.actions.selectAccountCreateCurrency("USD");
    const accountResponse = await settings.actions.submitAccountCreate();
    const newAccount = (await accountResponse.json()) as { id: string };
    await page.keyboard.press("Escape");

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await fxTransfer.actions.openCreateDialog();
    await fxTransfer.assert.dialogVisible();

    await fxTransfer.actions.selectFromAccount("acc-1");
    await fxTransfer.actions.selectToAccount(newAccount.id);
    await fxTransfer.actions.fillFromAmount("100");
    // Rate that's 25% above mid (0.032 → 0.04) — tolerance "block".
    await fxTransfer.actions.fillRate("0.04");
    await fxTransfer.actions.fillToAmount("4");
    await fxTransfer.actions.fillEntryDate(FX_DATE);

    // Wait for the gauge to surface the block-state copy so we know the
    // estimate actually resolved (vs. the start-up disabled state from M5).
    await fxTransfer.assert.gaugeShowsBlockState(5000);
    await fxTransfer.assert.submitDisabled();
  });
});
