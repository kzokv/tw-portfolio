import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShareCapability } from "@vakwen/shared-types";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";

const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("shared-context delegated capabilities", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createViewerShare(capabilities: ShareCapability[]) {
    const { userId: viewerUserId } = await app.persistence.resolveOrCreateUser("google", "shared-context-viewer-sub", {
      email: "shared-context-viewer@example.com",
      name: "Shared Context Viewer",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: viewerUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities,
      grantedByUserId: "user-1",
    });
    return { shareId: share.id, viewerUserId };
  }

  it("[shared transaction write]: viewer with transaction:write can create, patch, and delete owner transaction", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write"]);

    const created = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
        "idempotency-key": "shared-context-create-transaction-1",
      },
      payload: {
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        type: "BUY",
        isDayTrade: false,
      },
    });

    expect(created.statusCode).toBe(200);
    const tradeId = created.json<{ id: string }>().id;
    const ownerTrade = await app.persistence.getTradeEvent("user-1", tradeId);
    expect(ownerTrade).toBeTruthy();

    const patched = await app.inject({
      method: "PATCH",
      url: `/portfolio/transactions/${tradeId}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        quantity: 2,
      },
    });
    expect(patched.statusCode).toBe(202);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/portfolio/transactions/${tradeId}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(deleted.statusCode).toBe(202);
  });

  it("[shared transaction write]: viewer without transaction:write gets shared_capability_required", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
        "idempotency-key": "shared-context-create-transaction-2",
      },
      payload: {
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        type: "BUY",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "transaction:write",
        routeKey: "POST /portfolio/transactions",
      },
    });
  });

  it("[shared account manage]: viewer with account:manage can create, soft-delete, and restore owner account but cannot purge", async () => {
    const { shareId, viewerUserId } = await createViewerShare(["portfolio:mcp_read", "account:manage"]);

    const created = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        name: "Delegated Account",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    });
    expect(created.statusCode).toBe(200);
    const accountId = created.json<{ id: string }>().id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/accounts/${accountId}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(deleted.statusCode).toBe(200);

    const restored = await app.inject({
      method: "POST",
      url: `/accounts/${accountId}/restore`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(restored.statusCode).toBe(200);

    const deniedPurge = await app.inject({
      method: "POST",
      url: `/accounts/${accountId}/purge`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        confirmationName: "Delegated Account",
      },
    });
    expect(deniedPurge.statusCode).toBe(403);
    expect(deniedPurge.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        routeKey: "POST /accounts/:id/purge",
      },
    });

    const accountAudit = (app.persistence as unknown as {
      auditLog: Array<{ action: string; actorUserId: string | null; metadata: Record<string, unknown> }>;
    }).auditLog.filter((entry) =>
      entry.action === "account_soft_deleted" || entry.action === "account_restored");
    expect(accountAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "account_soft_deleted",
          actorUserId: viewerUserId,
          metadata: expect.objectContaining({
            ownerUserId: "user-1",
            contextUserId: "user-1",
            delegatedByUserId: viewerUserId,
            shareId,
          }),
        }),
        expect.objectContaining({
          action: "account_restored",
          actorUserId: viewerUserId,
          metadata: expect.objectContaining({
            ownerUserId: "user-1",
            contextUserId: "user-1",
            delegatedByUserId: viewerUserId,
            shareId,
          }),
        }),
      ]),
    );
  });

  it("[shared out-of-scope write]: viewer with account:manage cannot hit owner-only write routes", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "account:manage"]);
    const cases: Array<{ method: "POST" | "PUT" | "PATCH" | "DELETE"; url: string; routeKey: string }> = [
      { method: "POST", url: "/portfolio/snapshots/generate", routeKey: "POST /portfolio/snapshots/generate" },
      { method: "POST", url: "/portfolio/refresh-closes", routeKey: "POST /portfolio/refresh-closes" },
      { method: "POST", url: "/portfolio/recompute/preview", routeKey: "POST /portfolio/recompute/preview" },
      { method: "POST", url: "/portfolio/recompute/confirm", routeKey: "POST /portfolio/recompute/confirm" },
      { method: "POST", url: "/fx-transfers", routeKey: "POST /fx-transfers" },
      { method: "PATCH", url: "/fx-transfers/fx-test", routeKey: "PATCH /fx-transfers/:id" },
      { method: "POST", url: "/fx-transfers/fx-test/reverse", routeKey: "POST /fx-transfers/:id/reverse" },
      { method: "POST", url: "/portfolio/dividends/postings", routeKey: "POST /portfolio/dividends/postings" },
      {
        method: "PATCH",
        url: "/portfolio/dividends/postings/dividend-test/reconciliation",
        routeKey: "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation",
      },
      { method: "POST", url: "/corporate-actions", routeKey: "POST /corporate-actions" },
      { method: "PUT", url: "/monitored-tickers", routeKey: "PUT /monitored-tickers" },
      { method: "POST", url: "/backfill/retry", routeKey: "POST /backfill/retry" },
      { method: "POST", url: "/backfill/repair", routeKey: "POST /backfill/repair" },
      { method: "POST", url: "/share-tokens", routeKey: "POST /share-tokens" },
      { method: "DELETE", url: "/share-tokens/share-token-test", routeKey: "DELETE /share-tokens/:id" },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: testCase.method,
        url: testCase.url,
        headers: {
          "x-user-id": viewerUserId,
          "x-user-role": "viewer",
          "x-context-user-id": "user-1",
        },
        payload: testCase.method === "DELETE" ? undefined : {},
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: "shared_capability_required",
        metadata: { routeKey: testCase.routeKey },
      });
    }
  });

  it("[share capability audit]: active and pending updates include old/new capability arrays", async () => {
    const { userId: granteeUserId } = await app.persistence.resolveOrCreateUser("google", "cap-audit-grantee-sub", {
      email: "cap-audit-grantee@example.com",
      name: "Capability Audit Grantee",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });

    const activeUpdate = await app.inject({
      method: "PATCH",
      url: `/shares/${share.id}/capabilities`,
      headers: { "x-user-id": "user-1" },
      payload: { capabilities: ["portfolio:mcp_read", "transaction:write"] },
    });
    expect(activeUpdate.statusCode).toBe(200);

    const pendingCreate = await app.inject({
      method: "POST",
      url: "/shares",
      headers: { "x-user-id": "user-1" },
      payload: {
        email: "pending-cap-audit@example.com",
        capabilities: ["portfolio:mcp_read"],
      },
    });
    expect(pendingCreate.statusCode).toBe(201);
    const pendingCode = pendingCreate.json<{ type: "pending"; invite: { code: string } }>().invite.code;

    const pendingUpdate = await app.inject({
      method: "PATCH",
      url: `/shares/pending/${pendingCode}/capabilities`,
      headers: { "x-user-id": "user-1" },
      payload: { capabilities: ["portfolio:mcp_read", "account:manage"] },
    });
    expect(pendingUpdate.statusCode).toBe(200);

    const auditLog = (app.persistence as unknown as {
      auditLog: Array<{ action: string; metadata: Record<string, unknown> }>;
    }).auditLog.filter((entry) => entry.action === "share_capabilities_updated");

    expect(auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            shareId: share.id,
            oldCapabilities: ["portfolio:mcp_read"],
            newCapabilities: ["portfolio:mcp_read", "transaction:write"],
          }),
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            inviteCode: pendingCode,
            oldCapabilities: ["portfolio:mcp_read"],
            newCapabilities: ["account:manage", "portfolio:mcp_read"],
          }),
        }),
      ]),
    );
  });
});
