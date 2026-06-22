import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShareCapability } from "@vakwen/shared-types";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";

const SHARING_MANAGE = "sharing:manage" as ShareCapability;

const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("shared-context sharing manage", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createUser(sub: string, email: string, name: string) {
    return app.persistence.resolveOrCreateUser("google", sub, { email, name });
  }

  async function createViewerShare(
    capabilities: ShareCapability[],
    role: "member" | "viewer" = "member",
  ) {
    const id = Math.random().toString(36).slice(2, 10);
    const { userId: viewerUserId } = await createUser(
      `shared-sharing-viewer-${id}`,
      `shared-sharing-viewer-${id}@example.com`,
      "Shared Sharing Viewer",
    );
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
    return { shareId: share.id, viewerUserId, role };
  }

  async function createOwnerShareFor(email: string) {
    const target = await createUser(`target-${email}`, email, email);
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: target.userId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });
    return share;
  }

  async function createOwnerPendingInvite(email: string) {
    const invite = await app.persistence.createShareCoupledInvite({
      ownerUserId: "user-1",
      email,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      issuedByUserId: "user-1",
    });
    await app.persistence.setPendingShareInviteCapabilities({
      inviteCode: invite.code,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });
    return invite;
  }

  it("[shared sharing manage]: member without sharing:manage cannot create or edit owner shares", async () => {
    const { viewerUserId, role } = await createViewerShare(["portfolio:mcp_read"]);
    const activeShare = await createOwnerShareFor("owner-active-target@example.com");
    const pendingInvite = await createOwnerPendingInvite("owner-pending-target@example.com");

    const createResponse = await app.inject({
      method: "POST",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        email: "blocked-target@example.com",
        capabilities: ["portfolio:mcp_read"],
      },
    });
    expect(createResponse.statusCode).toBe(403);

    const patchActiveResponse = await app.inject({
      method: "PATCH",
      url: `/shares/${activeShare.id}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        capabilities: ["portfolio:mcp_read", "account:manage"],
      },
    });
    expect(patchActiveResponse.statusCode).toBe(403);

    const patchPendingResponse = await app.inject({
      method: "PATCH",
      url: `/shares/pending/${pendingInvite.code}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        capabilities: ["portfolio:mcp_read", "account:manage"],
      },
    });
    expect(patchPendingResponse.statusCode).toBe(403);
  });

  it("[self sharing read]: viewer can list own inbound shares without share-grantor role", async () => {
    const owner = await createUser("self-sharing-owner-sub", "self-sharing-owner@example.com", "Self Sharing Owner");
    const viewer = await createUser(
      "self-sharing-viewer-sub",
      "self-sharing-viewer@example.com",
      "Self Sharing Viewer",
    );
    const share = await app.persistence.createShareGrant({
      ownerUserId: owner.userId,
      granteeUserId: viewer.userId,
      auditInput: { actorUserId: owner.userId, ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: owner.userId,
    });

    const response = await app.inject({
      method: "GET",
      url: "/shares",
      headers: {
        "x-user-id": viewer.userId,
        "x-user-role": "viewer",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outbound: {
        active: [],
        pending: [],
        expired: [],
        revoked: [],
      },
      inbound: {
        active: [
          expect.objectContaining({
            id: share.id,
            ownerUserId: owner.userId,
            capabilities: expect.arrayContaining(["portfolio:mcp_read"]),
          }),
        ],
        revoked: [],
      },
    });
  });

  it("[shared sharing manage]: member with sharing:manage can create and update owner shares within their delegated subset", async () => {
    const { viewerUserId, role } = await createViewerShare([
      "portfolio:mcp_read",
      "account:manage",
      SHARING_MANAGE,
    ]);
    const targetEmail = "shared-sharing-target@example.com";
    const target = await createUser("shared-sharing-target-sub", targetEmail, "Target User");
    const activeShare = await createOwnerShareFor("owner-managed-active@example.com");
    const pendingInvite = await createOwnerPendingInvite("owner-managed-pending@example.com");

    const createResponse = await app.inject({
      method: "POST",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        email: targetEmail,
        capabilities: ["portfolio:mcp_read", "account:manage"],
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      type: "resolved",
      share: {
        ownerUserId: "user-1",
        granteeUserId: target.userId,
        capabilities: expect.arrayContaining(["portfolio:mcp_read", "account:manage"]),
      },
    });

    const patchActiveResponse = await app.inject({
      method: "PATCH",
      url: `/shares/${activeShare.id}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        capabilities: ["portfolio:mcp_read", "account:manage"],
      },
    });
    expect(patchActiveResponse.statusCode).toBe(200);
    expect(await app.persistence.getShareCapabilities(activeShare.id)).toEqual(
      expect.arrayContaining(["portfolio:mcp_read", "account:manage"]),
    );

    const patchPendingResponse = await app.inject({
      method: "PATCH",
      url: `/shares/pending/${pendingInvite.code}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        capabilities: ["portfolio:mcp_read", "account:manage"],
      },
    });
    expect(patchPendingResponse.statusCode).toBe(200);
    expect(await app.persistence.getPendingShareInviteCapabilities(pendingInvite.code)).toEqual(
      expect.arrayContaining(["portfolio:mcp_read", "account:manage"]),
    );
  });

  it("[shared sharing manage]: delegated revoke records the delegated actor as revoker", async () => {
    const { viewerUserId, role } = await createViewerShare([
      "portfolio:mcp_read",
      SHARING_MANAGE,
    ]);
    const activeShare = await createOwnerShareFor("owner-revoked-by-delegate@example.com");

    const revokeResponse = await app.inject({
      method: "DELETE",
      url: `/shares/${activeShare.id}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
    });

    expect(revokeResponse.statusCode).toBe(204);
    const outbound = await app.persistence.listSharesForOwner("user-1");
    expect(outbound.revoked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: activeShare.id,
          revokedByUserId: viewerUserId,
        }),
      ]),
    );
  });

  it("[shared sharing manage]: member cannot grant sharing:manage onward or exceed their delegated grant set", async () => {
    const { viewerUserId, role } = await createViewerShare([
      "portfolio:mcp_read",
      "account:manage",
      SHARING_MANAGE,
    ]);
    const targetEmail = "shared-sharing-overgrant@example.com";
    await createUser("shared-sharing-overgrant-sub", targetEmail, "Overgrant Target");
    const activeShare = await createOwnerShareFor("owner-overgrant-active@example.com");
    const pendingInvite = await createOwnerPendingInvite("owner-overgrant-pending@example.com");

    const createForwardedSharingManage = await app.inject({
      method: "POST",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        email: targetEmail,
        capabilities: ["portfolio:mcp_read", SHARING_MANAGE],
      },
    });
    expect(createForwardedSharingManage.statusCode).toBe(403);

    const createOutOfSubset = await app.inject({
      method: "POST",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        email: targetEmail,
        capabilities: ["portfolio:mcp_read", "transaction:write"],
      },
    });
    expect(createOutOfSubset.statusCode).toBe(403);

    const patchActiveForwardedSharingManage = await app.inject({
      method: "PATCH",
      url: `/shares/${activeShare.id}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        capabilities: ["portfolio:mcp_read", SHARING_MANAGE],
      },
    });
    expect(patchActiveForwardedSharingManage.statusCode).toBe(403);
    expect(await app.persistence.getShareCapabilities(activeShare.id)).toEqual(["portfolio:mcp_read"]);

    const patchPendingOutOfSubset = await app.inject({
      method: "PATCH",
      url: `/shares/pending/${pendingInvite.code}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: {
        capabilities: ["portfolio:mcp_read", "transaction:write"],
      },
    });
    expect(patchPendingOutOfSubset.statusCode).toBe(403);
    expect(await app.persistence.getPendingShareInviteCapabilities(pendingInvite.code)).toEqual(["portfolio:mcp_read"]);
  });

  it("[shared anonymous links]: member with sharing:manage still cannot list, create, or revoke owner public links", async () => {
    const { viewerUserId, role } = await createViewerShare(["portfolio:mcp_read", SHARING_MANAGE]);
    const createdToken = await app.persistence.createAnonymousShareToken({
      ownerUserId: "user-1",
      token: "ABCDEFGHIJKL1234567890",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ttlDays: 7,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    if (createdToken.status !== "ok") {
      throw new Error(`failed to seed anonymous token: ${createdToken.status}`);
    }

    const listResponse = await app.inject({
      method: "GET",
      url: "/share-tokens",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
    });
    expect(listResponse.statusCode).toBe(403);

    const createResponse = await app.inject({
      method: "POST",
      url: "/share-tokens",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
      payload: { expiresInDays: 30 },
    });
    expect(createResponse.statusCode).toBe(403);

    const revokeResponse = await app.inject({
      method: "DELETE",
      url: `/share-tokens/${createdToken.record.id}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": role,
        "x-context-user-id": "user-1",
      },
    });
    expect(revokeResponse.statusCode).toBe(403);
  });
});
