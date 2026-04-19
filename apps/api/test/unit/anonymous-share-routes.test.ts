import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppInstance } from "../../src/app.js";
import { buildApp } from "../../src/app.js";
import type { OAuthClaims } from "../../src/persistence/types.js";

async function seedUser(app: AppInstance, email: string) {
  const claims: OAuthClaims = {
    email,
    emailVerified: true,
    name: "Owner Name",
    picture: null,
  };
  const result = await app.persistence.resolveOrCreateUser("google", `sub-${email}`, claims);
  return result.userId;
}

describe("anonymous share routes", () => {
  let app: AppInstance;
  let ownerUserId: string;

  beforeEach(async () => {
    app = await buildApp({
      persistenceBackend: "memory",
      appBaseUrl: "http://localhost:3000",
    });
    ownerUserId = await seedUser(app, "owner@example.com");
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /share-tokens returns the dto directly and audits ttlDays", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/share-tokens",
      headers: {
        "x-user-id": ownerUserId,
        "x-user-role": "member",
      },
      payload: {
        expiresInDays: 30,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      id: string;
      token: string;
      url: string;
      createdAt: string;
      expiresAt: string;
      revokedAt: string | null;
      status: "active" | "expired" | "revoked";
    };
    expect(typeof body.id).toBe("string");
    expect(typeof body.token).toBe("string");
    expect(body.token).toHaveLength(22);
    expect(body.url).toBe(`http://localhost:3000/share/${body.token}`);
    expect(body.status).toBe("active");

    const audit = await app.persistence.listAuditLog({
      page: 1,
      limit: 10,
      actions: ["share_token_created"],
    });
    const entry = audit.items[0];
    expect(entry).toBeTruthy();
    expect(entry?.metadata).toMatchObject({
      tokenId: body.id,
      expiresAt: body.expiresAt,
      ttlDays: 30,
    });
  });

  it("test-only anonymous-share hooks match the scaffolding helper contract", async () => {
    const seeded = await app.inject({
      method: "POST",
      url: "/__e2e/seed-anonymous-share-token",
      headers: {
        "x-user-id": ownerUserId,
      },
      payload: {
        ownerUserId,
        expiresInDays: 5,
      },
    });

    expect(seeded.statusCode).toBe(200);
    const tokenBody = seeded.json() as {
      id: string;
      token: string;
      url: string;
      status: "active" | "expired" | "revoked";
    };
    expect(tokenBody.token).toHaveLength(22);
    expect(tokenBody.url).toBe(`http://localhost:3000/share/${tokenBody.token}`);
    expect(tokenBody.status).toBe("active");

    for (let i = 0; i < 30; i += 1) {
      const publicRes = await app.inject({
        method: "GET",
        url: `/share/${tokenBody.token}`,
        remoteAddress: "198.51.100.25",
      });
      expect(publicRes.statusCode).not.toBe(429);
    }

    const blocked = await app.inject({
      method: "GET",
      url: `/share/${tokenBody.token}`,
      remoteAddress: "198.51.100.25",
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("300");

    const reset = await app.inject({
      method: "POST",
      url: "/__e2e/anon-share-rate-reset",
      payload: { ip: "198.51.100.25" },
    });
    expect(reset.statusCode).toBe(200);

    const afterReset = await app.inject({
      method: "GET",
      url: `/share/${tokenBody.token}`,
      remoteAddress: "198.51.100.25",
    });
    expect(afterReset.statusCode).toBe(200);

    const deactivate = await app.inject({
      method: "POST",
      url: "/__e2e/anon-share-deactivate-owner",
      payload: { userId: ownerUserId },
    });
    expect(deactivate.statusCode).toBe(200);

    const afterDeactivate = await app.inject({
      method: "GET",
      url: `/share/${tokenBody.token}`,
      remoteAddress: "198.51.100.26",
    });
    expect(afterDeactivate.statusCode).toBe(404);
    expect(afterDeactivate.json()).toEqual({ error: "token_not_found", message: "token not found" });
  });
});
