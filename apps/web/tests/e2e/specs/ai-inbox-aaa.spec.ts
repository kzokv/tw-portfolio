import { Buffer } from "node:buffer";
import type { APIRequestContext, Locator } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

async function initializeMcpSession(request: APIRequestContext, headers: Record<string, string>) {
  const response = await request.post(new URL("/mcp", TestEnv.apiBaseUrl).href, {
    headers,
    data: {
      jsonrpc: "2.0",
      id: "init-e2e-1",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "Playwright", version: "1.0.0" },
      },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP initialize failed with ${response.status()}`);
  }
  const sessionId = response.headers()["mcp-session-id"];
  if (!sessionId) {
    throw new Error("MCP initialize did not return mcp-session-id");
  }
  return String(sessionId);
}

async function seedDraftBatch(request: APIRequestContext, userId: string): Promise<string> {
  const headers = {
    authorization: `Bearer ${devToken({
      userId,
      scopes: ["transaction_draft:create", "transaction_draft:edit"],
    })}`,
    accept: "application/json, text/event-stream",
  };
  const sessionId = await initializeMcpSession(request, headers);
  const response = await request.post(new URL("/mcp", TestEnv.apiBaseUrl).href, {
    headers: {
      ...headers,
      "mcp-session-id": sessionId,
    },
    data: {
      jsonrpc: "2.0",
      id: "call-e2e-1",
      method: "tools/call",
      params: {
        name: "create_transaction_draft_batch",
        arguments: {
          sourceLabel: "Playwright AI Inbox seed",
          candidates: Array.from({ length: 6 }, (_, index) => ({
            rowNumber: index + 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: index + 1,
            unitPrice: 100 + index,
            tradeDate: "2026-01-08",
            bookingSequence: index + 1,
          })),
        },
      },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP draft seed failed with ${response.status()}`);
  }
  const body = await response.text();
  const batchMatch = body.match(/[?&]batch=([^"&]+)/);
  const contextMatch = body.match(/[?&]context=([^"&]+)/);
  if (!batchMatch || !contextMatch) {
    throw new Error(`Could not extract seeded batch id from MCP response: ${body}`);
  }
  const responseUserId = decodeURIComponent(contextMatch[1]!.replace(/\\+$/, ""));
  if (responseUserId !== userId) {
    throw new Error(`Expected MCP deep link context ${userId}, received ${responseUserId}`);
  }
  return decodeURIComponent(batchMatch[1]!.replace(/\\+$/, ""));
}

async function assertAttribute(locator: Locator, name: string, expected: string): Promise<void> {
  const actual = await locator.getAttribute(name);
  if (actual !== expected) {
    throw new Error(`Expected ${name} to be ${expected}, received ${actual ?? "null"}`);
  }
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

test.describe("ai inbox", () => {
  test("[ai inbox]: MCP-seeded deep link → typed confirmation gates six-row posting", async ({
    appShell,
    e2eUserId,
    page,
    request,
  }) => {
    const batchId = await seedDraftBatch(request, e2eUserId);

    await appShell.actions.navigateToRoute(
      `/transactions?tab=ai-inbox&batch=${batchId}&context=${encodeURIComponent(e2eUserId)}`,
    );
    await appShell.assert.appIsReady();

    await page.getByTestId("ai-inbox-panel").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Playwright AI Inbox seed" }).waitFor({ state: "visible" });
    await assertAttribute(page.getByTestId("transactions-tab-ai-inbox"), "data-state", "active");

    const rowCheckboxes = page.getByLabel(/Select draft row \d+/);
    await assertCount(rowCheckboxes, 6, "draft-row checkboxes");
    for (const checkbox of await rowCheckboxes.all()) {
      await checkbox.check();
    }

    const typedPhrase = "POST 6 TRADES";
    const typedInput = page.getByPlaceholder(typedPhrase);
    const postButton = page.getByRole("button", { name: "Post selected" });

    await typedInput.waitFor({ state: "visible" });
    await assertDisabled(postButton, "Post selected button");

    await typedInput.fill(typedPhrase);
    const confirmResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST"
        && response.url().includes(`/ai/transaction-drafts/${batchId}/confirm`)
        && response.ok(),
    );
    await postButton.click();
    await confirmResponse;

    await page.getByText("Rows posted.").waitFor({ state: "visible" });
  });
});
