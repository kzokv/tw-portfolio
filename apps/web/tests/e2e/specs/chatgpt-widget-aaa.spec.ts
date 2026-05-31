import type { Locator, Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

async function openHarness(page: Page): Promise<void> {
  await page.goto("/connectors/chatgpt/transaction-draft/harness");
  await page.getByTestId("chatgpt-transaction-draft-widget").waitFor({ state: "visible" });
}

async function openWidgetTab(page: Page, name: "Import" | "Review" | "Post"): Promise<void> {
  await page.getByRole("tab", { name }).click();
}

async function assertCount(locator: Locator, expected: number, label: string): Promise<void> {
  const actual = await locator.count();
  if (actual !== expected) {
    throw new Error(`Expected ${expected} ${label}, received ${actual}`);
  }
}

async function assertDisabled(locator: Locator, label: string): Promise<void> {
  if (!(await locator.isDisabled())) {
    throw new Error(`Expected ${label} to be disabled`);
  }
}

async function assertEnabled(locator: Locator, label: string): Promise<void> {
  if (await locator.isDisabled()) {
    throw new Error(`Expected ${label} to be enabled`);
  }
}

async function assertText(locator: Locator, expected: string, label: string): Promise<void> {
  const text = await locator.textContent();
  if (text?.trim() !== expected) {
    throw new Error(`Expected ${label} text "${expected}", received "${text ?? ""}"`);
  }
}

async function assertBridgeReady(page: Page): Promise<void> {
  const ready = await page.evaluate(() => {
    const bridge = window.openai;
    return Boolean(
      bridge
      && typeof bridge.callTool === "function"
      && typeof bridge.setWidgetState === "function"
      && typeof bridge.setOpenInAppUrl === "function",
    );
  });
  if (!ready) {
    throw new Error("Expected mocked window.openai bridge to be ready");
  }
}

async function assertHarnessOpenInAppUrl(page: Page, expected: string): Promise<void> {
  const actual = await page.evaluate(() =>
    (window as Window & { __vakwenHarnessOpenInAppHref?: string }).__vakwenHarnessOpenInAppHref ?? null);
  if (actual !== expected) {
    throw new Error(`Expected harness open-in-app URL ${expected}, received ${actual ?? "null"}`);
  }
}

async function assertHarnessRowPatch(page: Page, rowId: string, expected: Record<string, unknown>): Promise<void> {
  const actual = await page.evaluate((id) => {
    const output = window.openai?.toolOutput;
    if (!output || typeof output !== "object" || !("rows" in output) || !Array.isArray(output.rows)) return null;
    return output.rows.find((row) => row && typeof row === "object" && "id" in row && row.id === id) ?? null;
  }, rowId);
  for (const [key, value] of Object.entries(expected)) {
    if (!actual || typeof actual !== "object" || (actual as Record<string, unknown>)[key] !== value) {
      throw new Error(`Expected harness row ${rowId}.${key} to be ${String(value)}`);
    }
  }
}

async function assertHarnessBatchStatus(page: Page, expected: string): Promise<void> {
  const actual = await page.evaluate(() => {
    const output = window.openai?.toolOutput;
    if (!output || typeof output !== "object" || !("batch" in output)) return null;
    const batch = output.batch;
    return batch && typeof batch === "object" && "status" in batch ? batch.status : null;
  });
  if (actual !== expected) {
    throw new Error(`Expected harness batch status ${expected}, received ${String(actual)}`);
  }
}

async function clearInitialSelection(page: Page): Promise<void> {
  await page.getByLabel("Select draft row 1").uncheck();
  await page.getByLabel("Select draft row 2").uncheck();
  await page.getByLabel("Select draft row 4").uncheck();
}

test.describe("chatgpt transaction draft widget", () => {
  test("[chatgpt widget]: harness render → bridge state and connector-only import boundary are visible", async ({
    page,
  }) => {
    await openHarness(page);

    await page.getByText("MCP Apps bridge only").waitFor({ state: "visible" });
    await page.getByText("No raw file sent to Vakwen").waitFor({ state: "visible" });
    await openWidgetTab(page, "Import");
    await page.getByText("Structured candidates plus capped provenance only").waitFor({ state: "visible" });
    await assertCount(page.locator('input[type="file"]'), 0, "raw file inputs");
    await assertBridgeReady(page);
    await assertHarnessOpenInAppUrl(page, "/transactions?tab=ai-inbox&batch=batch-chatgpt-1&context=user-1");
  });

  test("[chatgpt widget]: review actions → row edit and lifecycle mutations go through the mocked bridge", async ({
    page,
  }) => {
    await openHarness(page);
    await openWidgetTab(page, "Review");
    await clearInitialSelection(page);

    await page.getByTestId("chatgpt-widget-edit-row-3").click();
    await page.getByLabel("Account").fill("au-brokerage");
    await page.getByLabel("Note").fill("Confirmed from broker statement.");
    await page.getByRole("button", { name: "Save row" }).click();
    await page.getByText("Row saved.").waitFor({ state: "visible" });
    await assertHarnessRowPatch(page, "row-3", {
      accountId: "au-brokerage",
      note: "Confirmed from broker statement.",
    });

    await page.getByLabel("Select draft row 3").check();
    await page.getByRole("button", { name: "Exclude" }).click();
    await assertText(page.getByTestId("chatgpt-widget-row-state-row-3"), "excluded", "row 3 state");

    await page.getByRole("button", { name: "Reinclude" }).click();
    await assertText(page.getByTestId("chatgpt-widget-row-state-row-3"), "ready", "row 3 state");

    await page.getByRole("button", { name: "Reject" }).click();
    await assertText(page.getByTestId("chatgpt-widget-row-state-row-3"), "rejected", "row 3 state");

    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByText("Batch archived.").waitFor({ state: "visible" });
    await assertHarnessBatchStatus(page, "archived");

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByText("Batch deleted.").waitFor({ state: "visible" });
    await assertHarnessBatchStatus(page, "deleted");
  });

  test("[chatgpt widget]: low-risk posting → explicit button posts without typed phrase", async ({
    page,
  }) => {
    await openHarness(page);
    await openWidgetTab(page, "Review");

    await page.getByLabel("Select draft row 1").uncheck();
    await page.getByLabel("Select draft row 4").uncheck();
    await openWidgetTab(page, "Post");

    const postButton = page.getByTestId("chatgpt-widget-post-button");
    await assertEnabled(postButton, "low-risk post button");
    await assertCount(page.getByPlaceholder("POST 1 TRADES"), 0, "typed confirmation inputs");
    await postButton.click();

    await page.getByText("Latest posting result").waitFor({ state: "visible" });
    await page.getByText("Posted 1 rows and created 1 transactions.").waitFor({ state: "visible" });
  });

  test("[chatgpt widget]: high-risk posting → typed phrase gates bridge posting", async ({
    page,
  }) => {
    await openHarness(page);
    await openWidgetTab(page, "Post");

    const postButton = page.getByTestId("chatgpt-widget-post-button");
    const typedInput = page.getByPlaceholder("POST 3 TRADES");
    await typedInput.waitFor({ state: "visible" });
    await assertDisabled(postButton, "high-risk post button");

    await typedInput.fill("POST 3 TRADES");
    await postButton.click();

    await page.getByText("Latest posting result").waitFor({ state: "visible" });
    await page.getByText("Posted 3 rows and created 3 transactions.").waitFor({ state: "visible" });
  });
});
