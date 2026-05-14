// ui-enhancement — AAA E2E for the Settings → Accounts deletion flow.
//
// Coverage (architect-design §11):
//   [soft-delete]    Click "Delete account" → confirm in modal → row vanishes
//                    from accounts list AND appears in Recently-deleted.
//   [restore]        Recently-deleted Restore → row re-surfaces; collision
//                    case (sibling account owns the same name) auto-renames
//                    to "{name} (restored)".
//   [purge-now]      "Permanently delete now" → typed-name confirmation
//                    modal → final removal (row absent from BOTH lists).
//
// Reserved tickers: ACCDEL01–03 per
// `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` (claim-reserved
// in the rule even though this spec's lifecycle path doesn't seed trades).
//
// Seed discipline per `e2e-oauth-seed-as-browser.md`: arrange API calls run
// in fresh APIRequestContext via `withFreshContext`
// (`playwright-request-cookie-jar-isolation.md`); these are arrange-helpers,
// NOT assertions, so the AAA "no raw expect()" rule does not apply.

import {
  request as apiRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";

function apiPath(p: string): string {
  return new URL(p, TestEnv.apiBaseUrl).href;
}

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function getTestUserCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sc = cookies.find((c) => c.name === TestEnv.sessionCookieName);
  if (!sc) {
    throw new Error(`Session cookie "${TestEnv.sessionCookieName}" not found in browser context.`);
  }
  return `${sc.name}=${sc.value}`;
}

/** Arrange-helper — create a fresh active account owned by the BROWSER's user. */
async function createAccountAsBrowser(
  page: Page,
  payload: { name: string; defaultCurrency: "TWD" | "USD" | "AUD"; accountType: "broker" | "bank" | "wallet" },
): Promise<{ id: string; name: string }> {
  const cookieHeader = await getTestUserCookieHeader(page);
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/accounts"), {
      headers: { cookie: cookieHeader },
      data: payload,
    });
    if (!response.ok()) {
      throw new Error(`POST /accounts failed: ${response.status()} ${await response.text()}`);
    }
    return (await response.json()) as { id: string; name: string };
  });
}

/** Arrange-helper — soft-delete via API so the spec's act phase starts from the deleted state. */
async function softDeleteAsBrowser(page: Page, accountId: string): Promise<void> {
  const cookieHeader = await getTestUserCookieHeader(page);
  await withFreshContext(async (ctx) => {
    const resp = await ctx.delete(apiPath(`/accounts/${accountId}`), {
      headers: { cookie: cookieHeader },
    });
    if (!resp.ok()) {
      throw new Error(`pre-soft-delete failed: ${resp.status()} ${await resp.text()}`);
    }
  });
}

/** Arrange-helper — read accounts via API for collision-rename assertions. */
async function listAccountsAsBrowser(page: Page): Promise<Array<{ id: string; name: string }>> {
  const cookieHeader = await getTestUserCookieHeader(page);
  return withFreshContext(async (ctx) => {
    const resp = await ctx.get(apiPath("/accounts"), { headers: { cookie: cookieHeader } });
    if (!resp.ok()) throw new Error(`GET /accounts failed: ${resp.status()}`);
    return (await resp.json()) as Array<{ id: string; name: string }>;
  });
}

test.describe("ui-enhancement — Settings → Accounts deletion lifecycle", () => {
  test("[soft-delete] confirms modal → row vanishes from active list → appears in Recently-deleted", async ({
    page,
    appShell,
    settings,
  }) => {
    // Arrange — create a sibling account so the target isn't the last one.
    await createAccountAsBrowser(page, {
      name: "Keep Alive",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const target = await createAccountAsBrowser(page, {
      name: "Soft Delete Me",
      defaultCurrency: "TWD",
      accountType: "broker",
    });

    await appShell.actions.navigateToRoute("/dashboard?drawer=settings&settingsTab=accounts");
    await settings.assert.drawerIsVisible();
    await settings.assert.accountDeleteButtonIsVisible(target.id);

    // Act
    await settings.actions.clickAccountDeleteButton(target.id);
    await settings.assert.softDeleteModalIsVisible();
    await settings.actions.confirmSoftDelete();

    // Assert
    await settings.assert.softDeleteModalIsHidden();
    await settings.assert.accountCardIsHidden(target.id);
    await settings.assert.recentlyDeletedSectionIsVisible();
    await settings.assert.recentlyDeletedRowIsVisible(target.id);
  });

  test("[restore] restores a soft-deleted account; auto-renames on name collision", async ({
    page,
    appShell,
    settings,
  }) => {
    // Arrange — A and B share a name; A is soft-deleted while B remains active.
    await createAccountAsBrowser(page, {
      name: "Sibling Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const a = await createAccountAsBrowser(page, {
      name: "Restore Collide",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await softDeleteAsBrowser(page, a.id);
    const b = await createAccountAsBrowser(page, {
      name: "Restore Collide",
      defaultCurrency: "TWD",
      accountType: "broker",
    });

    await appShell.actions.navigateToRoute("/dashboard?drawer=settings&settingsTab=accounts");
    await settings.assert.drawerIsVisible();
    await settings.assert.recentlyDeletedRestoreButtonIsVisible(a.id);

    // Act
    await settings.actions.clickRecentlyDeletedRestore(a.id);

    // Assert — A re-surfaces with renamed suffix; B still owns the original name.
    await settings.assert.accountCardIsVisible(a.id);
    const list = await listAccountsAsBrowser(page);
    const aRow = list.find((r) => r.id === a.id);
    const bRow = list.find((r) => r.id === b.id);
    await settings.assert.mxAssertEqual(aRow?.name, "Restore Collide (restored)", "A.name");
    await settings.assert.mxAssertEqual(bRow?.name, "Restore Collide", "B.name");
  });

  test("[purge-now] typed-name confirmation removes the account from both lists", async ({
    page,
    appShell,
    settings,
  }) => {
    await createAccountAsBrowser(page, {
      name: "Keep Alive 2",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const target = await createAccountAsBrowser(page, {
      name: "Purge Now Target",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await softDeleteAsBrowser(page, target.id);

    await appShell.actions.navigateToRoute("/dashboard?drawer=settings&settingsTab=accounts");
    await settings.assert.drawerIsVisible();
    await settings.assert.recentlyDeletedPurgeButtonIsVisible(target.id);

    // Act + Assert — typed-name gate
    await settings.actions.clickRecentlyDeletedPurge(target.id);
    await settings.assert.permanentDeleteModalIsVisible();
    await settings.assert.permanentDeleteConfirmButtonIsDisabled();

    await settings.actions.fillPermanentDeleteConfirmation("Wrong Name");
    await settings.assert.permanentDeleteConfirmButtonIsDisabled();

    await settings.actions.fillPermanentDeleteConfirmation("Purge Now Target");
    await settings.assert.permanentDeleteConfirmButtonIsEnabled();
    await settings.actions.confirmPermanentDelete();

    await settings.assert.recentlyDeletedRowIsHidden(target.id);
    await settings.assert.accountCardIsHidden(target.id);
  });
});
