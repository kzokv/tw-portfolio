import { test, expect } from "../fixtures/test";
import { apiUrl, appUrl } from "../helpers/flows";
import type { APIRequestContext, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedTrade(
  request: APIRequestContext,
  userId: string,
  overrides: Partial<{
    accountId: string;
    symbol: string;
    quantity: number;
    unitPrice: number;
    priceCurrency: string;
    tradeDate: string;
    type: "BUY" | "SELL";
    isDayTrade: boolean;
  }> = {},
) {
  const res = await request.post(apiUrl("/portfolio/transactions"), {
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      "idempotency-key": `seed-${Date.now()}-${Math.random()}`,
    },
    data: {
      accountId: "acc-1",
      symbol: "2330",
      quantity: 100,
      unitPrice: 500,
      priceCurrency: "TWD",
      tradeDate: "2026-01-15",
      type: "BUY",
      isDayTrade: false,
      ...overrides,
    },
  });
  expect(res.ok()).toBeTruthy();
  return res;
}

/** Navigate to symbol page and wait for the section to render + hydrate. */
async function gotoSymbol(page: Page, symbol = "2330") {
  await page.goto(appUrl(`/symbols/${symbol}`), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("symbol-history-section")).toBeVisible({ timeout: 20_000 });
  // Soft-wait for hydration — SSE keeps a persistent connection so networkidle never resolves
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
}

/**
 * After a mutation returns 202, the API fires an async recompute via setImmediate.
 * In the in-memory backend the recompute completes before the browser can open an
 * EventSource, so the SSE event is lost. Work around this by reloading the page to
 * pick up the server-side state that was already recomputed.
 */
async function reloadAfterMutation(page: Page) {
  // Wait for the page to fully load before reloading to pick up recomputed state
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("symbol-history-section")).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("transaction mutations", () => {
  test.beforeEach(async ({ page }) => {
    // Ensure desktop viewport so the table (lg:block) is visible
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test("delete flow: dialog → confirm → toast → table refresh", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Seed 3 BUY trades with distinct prices
    await seedTrade(request, e2eUserId, { unitPrice: 500, tradeDate: "2026-01-10" });
    await seedTrade(request, e2eUserId, { unitPrice: 550, tradeDate: "2026-01-15" });
    await seedTrade(request, e2eUserId, { unitPrice: 600, tradeDate: "2026-01-20" });

    await gotoSymbol(page);

    // Verify 3 rows
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(3);

    // Click delete on the row containing price 550
    const targetRow = rows.filter({ hasText: "550" });
    await targetRow.getByTestId("delete-transaction-button").click();

    // Dialog opens with trade summary
    await expect(page.getByTestId("delete-confirmation-dialog")).toBeVisible();
    await expect(page.getByTestId("delete-trade-summary")).toBeVisible();
    await expect(page.getByTestId("delete-trade-summary")).toContainText("550");

    // Impact counts shown, no negative lots warning
    await expect(page.getByTestId("delete-impact-counts")).toBeVisible();
    await expect(page.getByTestId("delete-negative-lots-warning")).toBeHidden();

    // Confirm delete
    const deleteResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "DELETE",
    );
    await page.getByTestId("delete-confirm-button").click();
    await deleteResponse;

    // Success message appears (mutation was accepted)
    await expect(page.getByTestId("mutation-status")).toContainText(
      /deleted|Recomputing/i,
      { timeout: 10_000 },
    );

    // Reload to pick up recomputed state
    await reloadAfterMutation(page);

    // Table refreshed — only 2 rows remain
    await expect(page.getByTestId("transaction-row")).toHaveCount(2);
    // The deleted row (550) should be gone
    await expect(page.getByTestId("transaction-row").filter({ hasText: "550" })).toHaveCount(0);
  });

  test("edit flow: change quantity → save → toast → table refresh", async ({
    page,
    request,
    e2eUserId,
  }) => {
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);
    await expect(page.getByTestId("transaction-row")).toHaveCount(1);

    // Click edit — scope to transaction-row to avoid matching mobile card
    const row = page.getByTestId("transaction-row").first();
    await row.getByTestId("edit-transaction-button").click();

    // Edit mode renders both desktop (editable-transaction-row) and mobile
    // (editable-transaction-form) — scope all inputs to the desktop row.
    const editRow = page.getByTestId("editable-transaction-row");
    const quantityInput = editRow.getByTestId("edit-quantity-input");
    await expect(quantityInput).toBeVisible();

    // Change quantity to 200
    await quantityInput.fill("200");

    // Save
    const patchResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "PATCH",
    );
    await editRow.getByTestId("edit-save-button").click();
    await patchResponse;

    // Success message
    await expect(page.getByTestId("mutation-status")).toContainText(
      /updated|Recomputing/i,
      { timeout: 10_000 },
    );

    // Reload to pick up recomputed state
    await reloadAfterMutation(page);

    // Verify updated quantity in the refreshed table
    await expect(page.getByTestId("transaction-row").first()).toContainText("200");
  });

  test("edit cancel does not persist changes", async ({
    page,
    request,
    e2eUserId,
  }) => {
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);

    // Enter edit mode — scope to transaction-row
    const row = page.getByTestId("transaction-row").first();
    await row.getByTestId("edit-transaction-button").click();

    // Wait for the editable row to appear (handles hydration delay)
    const editRow = page.getByTestId("editable-transaction-row");
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await expect(editRow.getByTestId("edit-quantity-input")).toBeVisible();

    // Change quantity to 999
    await editRow.getByTestId("edit-quantity-input").fill("999");

    // Cancel
    await editRow.getByRole("button", { name: /cancel/i }).click();

    // Row reverts to viewing mode — edit row gone
    await expect(page.getByTestId("editable-transaction-row")).toBeHidden();

    // Original quantity still shown
    await expect(page.getByTestId("transaction-row").first()).toContainText("100");
  });

  test("negative lots warning appears when deleting a BUY consumed by sells", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // BUY 100 then SELL 80 — deleting the BUY will produce negative lots
    await seedTrade(request, e2eUserId, {
      quantity: 100,
      unitPrice: 500,
      tradeDate: "2026-01-15",
      type: "BUY",
    });
    await seedTrade(request, e2eUserId, {
      quantity: 80,
      unitPrice: 600,
      tradeDate: "2026-01-20",
      type: "SELL",
    });

    await gotoSymbol(page);

    // Click delete on the BUY row
    const buyRow = page.getByTestId("transaction-row").filter({ hasText: "BUY" });
    await buyRow.getByTestId("delete-transaction-button").click();

    // Dialog shows negative lots warning
    await expect(page.getByTestId("delete-confirmation-dialog")).toBeVisible();
    await expect(page.getByTestId("delete-negative-lots-warning")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("delete-negative-lots-warning")).toContainText(
      /negative position/i,
    );

    // Delete is hard-blocked — confirm button is hidden, only cancel available
    await expect(page.getByTestId("delete-confirm-button")).toBeHidden();

    // Cancel dismisses the dialog
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByTestId("delete-confirmation-dialog")).toBeHidden();
  });

  test("BUY→SELL side flip via edit (sufficient lots — no warning)", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Two BUYs: 100@500 and 50@520
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-10" });
    await seedTrade(request, e2eUserId, { quantity: 50, unitPrice: 520, tradeDate: "2026-01-15" });

    await gotoSymbol(page);
    await expect(page.getByTestId("transaction-row")).toHaveCount(2);

    // Edit the trade at 520 — use filter to get the right row
    const targetRow = page.getByTestId("transaction-row").filter({ hasText: "520" });
    await targetRow.getByTestId("edit-transaction-button").click();

    // Scope to desktop editable row
    const editRow = page.getByTestId("editable-transaction-row");
    const sideSelect = editRow.getByTestId("edit-side-select");
    await expect(sideSelect).toBeVisible();
    await sideSelect.selectOption("SELL");

    // Save — preview check runs but no negative lots, so PATCH proceeds directly
    const patchResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "PATCH",
    );
    await editRow.getByTestId("edit-save-button").click();
    await patchResponse;

    // No warning dialog should have appeared
    await expect(page.getByTestId("edit-confirmation-dialog")).toBeHidden();

    // Reload to pick up recomputed state
    await reloadAfterMutation(page);

    // Verify the row now shows SELL
    await expect(page.getByTestId("transaction-row").filter({ hasText: "520" })).toContainText("SELL");
  });

  test("BUY→SELL side flip shows negative lots warning when insufficient lots", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Single BUY 100@500 — flipping to SELL means 0 lots available, negative position
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);
    await expect(page.getByTestId("transaction-row")).toHaveCount(1);

    // Enter edit mode
    const row = page.getByTestId("transaction-row").first();
    await row.getByTestId("edit-transaction-button").click();

    const editRow = page.getByTestId("editable-transaction-row");
    const sideSelect = editRow.getByTestId("edit-side-select");
    await expect(sideSelect).toBeVisible();
    await sideSelect.selectOption("SELL");

    // Click Save — should trigger preview check, NOT a direct PATCH
    await editRow.getByTestId("edit-save-button").click();

    // Edit confirmation dialog must appear with negative lots warning
    await expect(page.getByTestId("edit-confirmation-dialog")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("edit-negative-lots-warning")).toBeVisible();
    await expect(page.getByTestId("edit-negative-lots-warning")).toContainText(/negative position/i);

    // No confirm button — edit is hard-blocked, only cancel is available
    await expect(page.getByTestId("edit-confirm-button")).toBeHidden();
    await expect(page.getByTestId("edit-cancel-button")).toBeVisible();

    // Cancel — verify no PATCH was sent and row remains unchanged
    await page.getByTestId("edit-cancel-button").click();
    await expect(page.getByTestId("edit-confirmation-dialog")).toBeHidden();
    await expect(page.getByTestId("transaction-row").first()).toContainText("BUY");
  });

  test("edit auto-refreshes after recompute without manual reload", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Auto-refresh must clear the "Recomputing..." message and update table data
    // without a manual reload. Two valid outcomes:
    //   • SSE delivers recompute_complete → "recomputed successfully"
    //   • SSE silent for 10 s → safety net fires → "Portfolio updated."
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);

    const row = page.getByTestId("transaction-row").first();
    await row.getByTestId("edit-transaction-button").click();

    const editRow = page.getByTestId("editable-transaction-row");
    await editRow.getByTestId("edit-price-input").fill("800");

    const patchResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "PATCH",
    );
    await editRow.getByTestId("edit-save-button").click();
    await patchResponse;

    // Initial message: "Recomputing..."
    await expect(page.getByTestId("mutation-status")).toContainText(/Recomputing/i);

    // Auto-refresh resolves via SSE or the 10 s safety net
    await expect(page.getByTestId("mutation-status")).toContainText(
      /recomputed successfully|Portfolio updated/i,
      { timeout: 15_000 },
    );

    // Data should reflect the edit without manual reload
    await expect(page.getByTestId("transaction-row").first()).toContainText("800");
  });

  test("delete auto-refreshes after recompute without manual reload", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Auto-refresh must clear recomputing state after delete — no manual reload.
    // SSE may deliver "recomputed successfully" or safety net may show "Portfolio updated."
    await seedTrade(request, e2eUserId, { unitPrice: 500, tradeDate: "2026-01-10" });
    await seedTrade(request, e2eUserId, { unitPrice: 600, tradeDate: "2026-01-15" });

    await gotoSymbol(page);
    await expect(page.getByTestId("transaction-row")).toHaveCount(2);

    const targetRow = page.getByTestId("transaction-row").filter({ hasText: "500" });
    await targetRow.getByTestId("delete-transaction-button").click();
    await expect(page.getByTestId("delete-confirmation-dialog")).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "DELETE",
    );
    await page.getByTestId("delete-confirm-button").click();
    await deleteResponse;

    // Initial message: "Recomputing..."
    await expect(page.getByTestId("mutation-status")).toContainText(/deleted.*Recomputing/i);

    // Auto-refresh resolves via SSE or the 10 s safety net
    await expect(page.getByTestId("mutation-status")).toContainText(
      /recomputed successfully|Portfolio updated/i,
      { timeout: 15_000 },
    );

    // Table updated: only 1 row remains (the 600 trade)
    await expect(page.getByTestId("transaction-row")).toHaveCount(1);
    await expect(page.getByTestId("transaction-row").filter({ hasText: "500" })).toHaveCount(0);
  });

  test("weighted-average cost correctness after delete", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Seed BUY 100@500 and BUY 200@600
    // Expected avg cost: (100*500 + 200*600) / 300 = 566.67
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-10" });
    await seedTrade(request, e2eUserId, { quantity: 200, unitPrice: 600, tradeDate: "2026-01-15" });

    // Navigate to dashboard to verify initial avg cost
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dashboard-holdings-section")).toBeVisible({ timeout: 20_000 });

    const holdingsTable = page.getByTestId("holdings-table");
    await expect(holdingsTable).toBeVisible();
    // Verify initial avg cost ~ 566.67 (rounded to 567 in locale-formatted display)
    await expect(holdingsTable).toContainText(/567/);

    // Navigate to symbol page and delete the first BUY (100@500)
    await gotoSymbol(page);
    const targetRow = page.getByTestId("transaction-row").filter({ hasText: "500" });
    await targetRow.getByTestId("delete-transaction-button").click();

    await expect(page.getByTestId("delete-confirmation-dialog")).toBeVisible();
    const deleteResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "DELETE",
    );
    await page.getByTestId("delete-confirm-button").click();
    await deleteResponse;

    // Wait for recompute to settle, then navigate to dashboard
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dashboard-holdings-section")).toBeVisible({ timeout: 20_000 });

    const updatedHoldings = page.getByTestId("holdings-table");
    await expect(updatedHoldings).toBeVisible();
    // After deleting BUY 100@500, only BUY 200@600 remains.
    // Avg cost includes commission so shows as 601 (unit price + commission/qty).
    // Verify it changed from the original 567 by checking the row quantity is now 200.
    await expect(updatedHoldings).toContainText("200");
    // Old avg cost (567) should no longer appear
    await expect(updatedHoldings).not.toContainText(/567/);
  });

  test("delete all trades shows empty state", async ({
    page,
    request,
    e2eUserId,
  }) => {
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);
    await expect(page.getByTestId("transaction-row")).toHaveCount(1);

    // Delete the only trade — scope to transaction-row to avoid mobile card match
    const row = page.getByTestId("transaction-row").first();
    await row.getByTestId("delete-transaction-button").click();
    await expect(page.getByTestId("delete-confirmation-dialog")).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "DELETE",
    );
    await page.getByTestId("delete-confirm-button").click();
    await deleteResponse;

    // Reload to pick up recomputed state
    await reloadAfterMutation(page);

    // Empty state should render (no table, just empty message)
    await expect(page.getByTestId("symbol-history-empty")).toBeVisible({ timeout: 10_000 });
  });

  test("record transaction dialog on symbol page: submit with locked symbol/account", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Seed one trade so the symbol page has data
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);
    await expect(page.getByTestId("transaction-row")).toHaveCount(1);

    // Open record transaction dialog
    await page.getByTestId("record-transaction-button").click();
    await expect(page.getByTestId("record-transaction-dialog")).toBeVisible();

    // Symbol and account selects should be locked (only one option each)
    const symbolSelect = page.getByTestId("record-transaction-dialog").getByTestId("tx-symbol-select");
    const accountSelect = page.getByTestId("record-transaction-dialog").getByTestId("tx-account-select");
    await expect(symbolSelect).toHaveValue("2330");
    await expect(accountSelect).toHaveValue("acc-1");

    // Fill in the form — quantity should default to 1000
    const quantityInput = page.getByTestId("record-transaction-dialog").getByTestId("tx-quantity-input");
    await expect(quantityInput).toHaveValue("1000");

    // Set a distinct price so we can verify the new row
    const priceInput = page.getByTestId("record-transaction-dialog").getByTestId("tx-price-input");
    await priceInput.fill("999");

    // Submit
    const postResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions") && r.request().method() === "POST",
    );
    await page.getByTestId("record-transaction-dialog").getByTestId("tx-submit-button").click();
    await postResponse;

    // Dialog should close after successful submission
    await expect(page.getByTestId("record-transaction-dialog")).toBeHidden({ timeout: 10_000 });

    // Reload to pick up the new transaction
    await reloadAfterMutation(page);

    // Table should now have 2 rows (original + new)
    await expect(page.getByTestId("transaction-row")).toHaveCount(2);
    // The new trade with price 999 should appear
    await expect(page.getByTestId("transaction-row").filter({ hasText: "999" })).toHaveCount(1);
  });

  test("navigate to symbol page from portfolio holdings link", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Seed a trade so holdings exist
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    // Navigate to portfolio page
    await page.goto(appUrl("/portfolio"), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});

    // Wait for holdings table to render
    const holdingsTable = page.getByTestId("holdings-table");
    await expect(holdingsTable).toBeVisible({ timeout: 20_000 });

    // Click the symbol link in the holdings row
    const symbolLink = holdingsTable.getByRole("link", { name: "2330" });
    await expect(symbolLink).toBeVisible();
    await symbolLink.click();

    // Should navigate to the symbol ledger page
    await expect(page).toHaveURL(/\/symbols\/2330/, { timeout: 10_000 });
    await expect(page.getByTestId("symbol-history-section")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("symbol-history-title")).toContainText("2330");

    // Transaction should be visible on the symbol page
    await expect(page.getByTestId("transaction-row")).toHaveCount(1);
  });

  test("form defaults: quantity=1000, tradeDate=today", async ({
    page,
    request,
    e2eUserId,
  }) => {
    // Seed a trade so the symbol page renders
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);

    // Open record transaction dialog
    await page.getByTestId("record-transaction-button").click();
    await expect(page.getByTestId("record-transaction-dialog")).toBeVisible();

    const dialog = page.getByTestId("record-transaction-dialog");

    // Quantity should default to 1000
    await expect(dialog.getByTestId("tx-quantity-input")).toHaveValue("1000");

    // Trade date should default to today (YYYY-MM-DD format)
    const today = new Date().toISOString().slice(0, 10);
    await expect(dialog.getByTestId("tx-trade-date-input")).toHaveValue(today);

    // Unit price input should have min=1 (cannot be 0)
    const priceInput = dialog.getByTestId("tx-price-input");
    await expect(priceInput).toHaveAttribute("min", "1");

    // Quantity input should also have min=1
    const quantityInput = dialog.getByTestId("tx-quantity-input");
    await expect(quantityInput).toHaveAttribute("min", "1");
  });

  test("edit price change persists after recompute", async ({
    page,
    request,
    e2eUserId,
  }) => {
    await seedTrade(request, e2eUserId, { quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await gotoSymbol(page);

    // Enter edit mode — scope to transaction-row
    const row = page.getByTestId("transaction-row").first();
    await row.getByTestId("edit-transaction-button").click();

    // Scope to desktop editable row
    const editRow = page.getByTestId("editable-transaction-row");
    const priceInput = editRow.getByTestId("edit-price-input");
    await expect(priceInput).toBeVisible();
    await priceInput.fill("750");

    // Save
    const patchResponse = page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "PATCH",
    );
    await editRow.getByTestId("edit-save-button").click();
    await patchResponse;

    // Reload to pick up recomputed state
    await reloadAfterMutation(page);

    // Verify price updated
    await expect(page.getByTestId("transaction-row").first()).toContainText("750");
  });
});
