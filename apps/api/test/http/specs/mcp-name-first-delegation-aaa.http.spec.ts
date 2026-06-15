import { Buffer } from "node:buffer";
import type { APIRequestContext } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const mcpUrl = new URL("/mcp", TestEnv.apiBaseUrl).href;
const mcpAdminFreshAuthUrl = new URL("/admin/mcp/fresh-auth", TestEnv.apiBaseUrl).href;
const mcpAdminSettingsUrl = new URL("/admin/mcp/settings", TestEnv.apiBaseUrl).href;
const sharesUrl = new URL("/shares", TestEnv.apiBaseUrl).href;

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function parseMcpJson<T>(body: string): T {
  if (body.trim().startsWith("{")) return JSON.parse(body) as T;
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

function mcpStructuredContent<T>(body: string, label: string): T {
  const envelope = parseMcpJson<{
    result?: {
      structuredContent?: unknown;
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    error?: unknown;
  }>(body);
  if (envelope.result?.structuredContent) return envelope.result.structuredContent as T;
  const text = envelope.result?.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (text?.trim().startsWith("{")) return JSON.parse(text) as T;
  throw new Error(`Unexpected MCP ${label} response: ${body}`);
}

function mcpConfirmation(body: string, label: string) {
  const content = mcpStructuredContent<{ confirmationSummary?: unknown; confirmationDigest?: unknown }>(body, label);
  if (typeof content.confirmationSummary !== "string" || typeof content.confirmationDigest !== "string") {
    throw new Error(`Unexpected MCP ${label} confirmation response: ${body}`);
  }
  return {
    confirmationSummary: content.confirmationSummary,
    confirmationDigest: content.confirmationDigest,
  };
}

async function initializeMcpSession(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const response = await request.post(mcpUrl, {
    headers,
    data: {
      jsonrpc: "2.0",
      id: "init-mcp-name-first-aaa",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "Playwright", version: "1.0.0" },
      },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP initialize failed: ${response.status()} ${await response.text()}`);
  }
  const sessionId = response.headers()["mcp-session-id"];
  if (!sessionId) throw new Error("MCP initialize did not return mcp-session-id");
  return sessionId;
}

async function callMcpTool(
  request: APIRequestContext,
  headers: Record<string, string>,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await request.post(mcpUrl, {
    headers: {
      ...headers,
      "mcp-session-id": sessionId,
    },
    data: {
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP ${name} failed: ${response.status()} ${await response.text()}`);
  }
  return response.text();
}

function assertNoVisibleIds(value: unknown, label: string): void {
  const visibleJson = JSON.stringify(value);
  for (const forbidden of ["accountId", "batchId", "rowId", "portfolioContextUserId"]) {
    if (visibleJson.includes(forbidden)) {
      throw new Error(`${label} exposed ${forbidden}: ${visibleJson}`);
    }
  }
}

test.describe("MCP name-first delegation", () => {
  test("[mcp delegation]: grantee manages owner account and posts draft rows by human names", async ({
    request,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "mcp-name-first-owner-sub",
      email: "mcp-name-first-owner@example.com",
      name: "MCP Name First Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "mcp-name-first-grantee-sub",
      email: "mcp-name-first-grantee@example.com",
      name: "MCP Name First Grantee",
      role: "viewer",
    });

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    const share = sharesApi.arrange.asResolvedBody(createBody);
    const shareId = String(share.share["id"]);
    const capabilities = [
      "portfolio:mcp_read",
      "account:manage",
      "transaction_draft:create",
      "transaction_draft:edit",
      "transaction:write",
    ];
    const grantResponse = await request.patch(`${sharesUrl}/${shareId}/capabilities`, {
      headers: {
        cookie: owner.cookieHeader,
        "content-type": "application/json",
      },
      data: { capabilities },
    });
    await sharesApi.assert.statusIs(grantResponse, 200);

    const freshAuthResponse = await request.post(mcpAdminFreshAuthUrl, {
      headers: { cookie: owner.cookieHeader },
    });
    await sharesApi.assert.statusIs(freshAuthResponse, 200);
    const freshAuthBody = await freshAuthResponse.json() as { freshAuthToken: string };
    const settingsResponse = await request.patch(mcpAdminSettingsUrl, {
      headers: {
        cookie: owner.cookieHeader,
        "content-type": "application/json",
        "x-vakwen-fresh-auth-at": freshAuthBody.freshAuthToken,
      },
      data: { groupToggles: { read: true, drafts: true, write: true } },
    });
    await sharesApi.assert.statusIs(settingsResponse, 200);

    const headers = {
      authorization: `Bearer ${devToken({ userId: grantee.userId, scopes: capabilities })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(request, headers);

    const contextsText = await callMcpTool(request, headers, sessionId, "list_portfolio_contexts", {});
    const contexts = mcpStructuredContent<{ portfolios: Array<{ label: string; email: string | null; isSelf: boolean }> }>(
      contextsText,
      "list_portfolio_contexts",
    );
    const portfolio = contexts.portfolios.find((item) => !item.isSelf);
    await sharesApi.assert.mxAssertDefined(portfolio, "delegated portfolio is discoverable");
    assertNoVisibleIds(contexts, "portfolio contexts");

    const portfolioSelector = { label: portfolio!.label, ...(portfolio!.email ? { email: portfolio!.email } : {}) };
    const accountName = "MCP AAA Delegated Account";
    const accountPreviewText = await callMcpTool(request, headers, sessionId, "preview_create_account_by_name", {
      portfolio: portfolioSelector,
      name: accountName,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const accountPreview = mcpConfirmation(
      accountPreviewText,
      "preview_create_account_by_name",
    );
    const accountCreateText = await callMcpTool(request, headers, sessionId, "create_account_by_name", {
      portfolio: portfolioSelector,
      name: accountName,
      defaultCurrency: "TWD",
      accountType: "broker",
      confirmationSummary: accountPreview.confirmationSummary,
      confirmationDigest: accountPreview.confirmationDigest,
    });
    const accountCreate = mcpStructuredContent<{ account: { name: string } }>(
      accountCreateText,
      "create_account_by_name",
    );
    await sharesApi.assert.mxAssertEqual(accountCreate.account.name, accountName, "created account name");
    assertNoVisibleIds(accountCreate, "account create");

    const preflightText = await callMcpTool(request, headers, sessionId, "preflight_transaction_draft_candidates_by_name", {
      portfolio: portfolioSelector,
      sourceLabel: "MCP AAA delegated draft",
      candidates: [{
        rowNumber: 1,
        recordType: "trade",
        accountName,
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-04-01",
      }],
    });
    const preflight = mcpConfirmation(
      preflightText,
      "preflight_transaction_draft_candidates_by_name",
    );
    const createdBatchText = await callMcpTool(request, headers, sessionId, "create_transaction_draft_batch_by_name", {
      portfolio: portfolioSelector,
      sourceLabel: "MCP AAA delegated draft",
      candidates: [{
        rowNumber: 1,
        recordType: "trade",
        accountName,
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-04-01",
      }],
      confirmationSummary: preflight.confirmationSummary,
      confirmationDigest: preflight.confirmationDigest,
    });
    const createdBatch = mcpStructuredContent<{ batch: { batchLabel: string } }>(
      createdBatchText,
      "create_transaction_draft_batch_by_name",
    );
    const batchLabel = createdBatch.batch.batchLabel;
    await sharesApi.assert.mxAssertEqual(batchLabel, "MCP AAA delegated draft", "batch label");
    assertNoVisibleIds(createdBatch, "draft batch create");

    const postingPreviewText = await callMcpTool(request, headers, sessionId, "get_transaction_draft_posting_preview_by_name", {
      portfolio: portfolioSelector,
      batchLabel,
      rowNumbers: [1],
    });
    const postingPreview = mcpStructuredContent<{
      preview: { rows: Array<{ rowNumber: number; accountName: string }> };
      confirmationSummary: string;
      confirmationDigest: string;
    }>(postingPreviewText, "get_transaction_draft_posting_preview_by_name");
    await sharesApi.assert.mxAssertEqual(postingPreview.preview.rows[0]?.accountName, accountName, "posting account name");
    assertNoVisibleIds(postingPreview, "posting preview");

    const postedText = await callMcpTool(request, headers, sessionId, "post_transaction_draft_rows_by_name", {
      portfolio: portfolioSelector,
      batchLabel,
      rowNumbers: [1],
      idempotencyKey: "mcp-name-first-aaa-post",
      confirmationSummary: postingPreview.confirmationSummary,
      confirmationDigest: postingPreview.confirmationDigest,
    });
    const posted = mcpStructuredContent<{ outcome: string; postedRowNumbers: number[]; createdTransactionCount: number }>(
      postedText,
      "post_transaction_draft_rows_by_name",
    );
    await sharesApi.assert.mxAssertEqual(posted.outcome, "posted", "posting outcome");
    await sharesApi.assert.mxAssertEqual(posted.createdTransactionCount, 1, "created transaction count");
    assertNoVisibleIds(posted, "posting result");

    const recentText = await callMcpTool(request, headers, sessionId, "get_recent_transactions", {
      portfolio: portfolioSelector,
      accountNames: [accountName],
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
      limit: 10,
      offset: 0,
    });
    const recent = mcpStructuredContent<{ total: number; items: Array<{ accountName: string; ticker: string }> }>(
      recentText,
      "get_recent_transactions",
    );
    await sharesApi.assert.mxAssertEqual(recent.total, 1, "recent transaction count");
    await sharesApi.assert.mxAssertEqual(recent.items[0]?.accountName, accountName, "recent transaction account name");
  });
});
