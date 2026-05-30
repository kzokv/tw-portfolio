/**
 * ui-enhancement — Role-guard + shared-context-guard coverage for the four
 * new account-lifecycle routes (P1-1, Codex iter-3 adversarial review).
 *
 * Routes under test:
 *   - DELETE /accounts/:id            (soft-delete)
 *   - POST   /accounts/:id/restore    (restore)
 *   - POST   /accounts/:id/purge      (hard-purge with typed-name confirmation)
 *   - GET    /accounts/deleted        (Recently-deleted listing)
 *
 * Two role/context dimensions per write route:
 *   1. **Viewer role** — Backend adds these route keys to `WRITER_ROLE_ROUTE_KEYS`;
 *      a session opened with `?role=viewer` must receive 403.
 *   2. **Shared-portfolio grantee with x-context-user-id** — Backend adds
 *      these route keys to `WRITE_CONTEXT_GUARD_ROUTE_KEYS`; a grantee
 *      acting AS the owner via the context header must receive 403 on the
 *      WRITES (delete / restore / purge). GET /accounts/deleted is a READ
 *      and is NOT expected to be in the WRITE context-guard list; this spec
 *      verifies that the GET stays accessible under the shared context per
 *      the Backend's documented decision (or 403s consistently if they
 *      added it to the guard).
 *
 * Per `service-error-pattern.md`: body envelope is `{ error: "<code>", message: ... }`.
 * Read `body.error`, never `body.code`. The exact code surfaced is the
 * existing 403 envelope used by Backend for these route-key sets:
 *   - `share_grant_forbidden` for viewer role guard (mirrors `WRITER_ROLE_*`)
 *   - `write_blocked_viewing_shared` for shared-context guard (mirrors
 *     `WRITE_CONTEXT_GUARD_*` — see `switcher-write-blocked-aaa.http.spec.ts`)
 *
 * If Backend uses a different envelope code for the new account-lifecycle
 * routes, only `body.error` truthiness is asserted in some cases — the
 * status code (403) is the load-bearing guarantee.
 */

import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("account-lifecycle route guards (ui-enhancement P1-1)", () => {
  // ── Viewer-role 403s on the 3 write routes ──────────────────────────────

  test("[viewer→DELETE /accounts/:id]: viewer-role session → 403", async ({
    request,
    accountsApi,
  }) => {
    const viewer = await createOauthSession(request, {
      sub: "account-lifecycle-viewer-delete-sub",
      email: "viewer-delete@example.com",
      name: "Viewer Delete",
      role: "viewer",
    });

    const response = await accountsApi.actions.softDeleteAccountForCookie(
      viewer.cookieHeader,
      "acc-arbitrary",
    );
    await accountsApi.assert.statusIs(response, 403);
  });

  test("[viewer→POST /accounts/:id/restore]: viewer-role session → 403", async ({
    request,
    accountsApi,
  }) => {
    const viewer = await createOauthSession(request, {
      sub: "account-lifecycle-viewer-restore-sub",
      email: "viewer-restore@example.com",
      name: "Viewer Restore",
      role: "viewer",
    });

    const response = await accountsApi.actions.restoreAccountForCookie(
      viewer.cookieHeader,
      "acc-arbitrary",
    );
    await accountsApi.assert.statusIs(response, 403);
  });

  test("[viewer→POST /accounts/:id/purge]: viewer-role session → 403", async ({
    request,
    accountsApi,
  }) => {
    const viewer = await createOauthSession(request, {
      sub: "account-lifecycle-viewer-purge-sub",
      email: "viewer-purge@example.com",
      name: "Viewer Purge",
      role: "viewer",
    });

    const response = await accountsApi.actions.permanentlyDeleteAccountForCookie(
      viewer.cookieHeader,
      "acc-arbitrary",
      "anything",
    );
    await accountsApi.assert.statusIs(response, 403);
  });

  // Viewer-role on the READ endpoint — viewers can typically still GET
  // their own data (Backend's WRITER_ROLE_* list is about writes). This case
  // documents the contract: GET /accounts/deleted is allowed for viewer; if
  // Backend includes it in WRITER_ROLE_*, the spec will fail and surface the
  // policy inconsistency.
  test("[viewer→GET /accounts/deleted]: viewer can read own deleted list → 200", async ({
    request,
    accountsApi,
  }) => {
    const viewer = await createOauthSession(request, {
      sub: "account-lifecycle-viewer-read-deleted-sub",
      email: "viewer-read-deleted@example.com",
      name: "Viewer Read Deleted",
      role: "viewer",
    });

    const response = await accountsApi.actions.listDeletedAccountsForCookie(
      viewer.cookieHeader,
    );
    await accountsApi.assert.statusIs(response, 200);
  });

  // ── Shared-context grantee 403s on the 3 write routes ────────────────────

  test("[shared-context→DELETE /accounts/:id]: grantee + x-context-user-id=owner → 403", async ({
    request,
    accountsApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "account-lifecycle-shared-delete-owner-sub",
      email: "delete-owner@example.com",
      name: "Delete Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "account-lifecycle-shared-delete-grantee-sub",
      email: "delete-grantee@example.com",
      name: "Delete Grantee",
      role: "member",
    });

    // Owner creates an account that the grantee will (try to) soft-delete.
    const created = await accountsApi.actions.createAccountForCookie(
      owner.cookieHeader,
      {
        name: "Delete Context Target",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    );
    await accountsApi.assert.statusIs(created, 200);
    const createdBody = (await accountsApi.arrange.body(created)) as Record<string, unknown>;
    const accountId = String(createdBody.id);

    // Owner shares portfolio with grantee.
    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    sharesApi.arrange.asResolvedBody(createBody);

    // Grantee acts AS owner via x-context-user-id → blocked.
    const response = await accountsApi.actions.softDeleteAccountForCookie(
      grantee.cookieHeader,
      accountId,
      owner.userId,
    );
    await accountsApi.assert.statusIs(response, 403);

    // And the owner's account row is still active (read-back as owner).
    const list = await accountsApi.actions.listAccountsForCookie(owner.cookieHeader);
    const accounts = await accountsApi.arrange.accounts(list);
    if (!accounts.find((a) => a["id"] === accountId)) {
      throw new Error(`Expected account ${accountId} to remain active after blocked delete`);
    }
  });

  test("[shared-context→POST /accounts/:id/restore]: grantee + x-context-user-id=owner → 403", async ({
    request,
    accountsApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "account-lifecycle-shared-restore-owner-sub",
      email: "restore-owner@example.com",
      name: "Restore Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "account-lifecycle-shared-restore-grantee-sub",
      email: "restore-grantee@example.com",
      name: "Restore Grantee",
      role: "member",
    });

    const created = await accountsApi.actions.createAccountForCookie(
      owner.cookieHeader,
      {
        name: "Restore Context Target",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    );
    const createdBody = (await accountsApi.arrange.body(created)) as Record<string, unknown>;
    const accountId = String(createdBody.id);

    await accountsApi.actions.softDeleteAccountForCookie(owner.cookieHeader, accountId);

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    sharesApi.arrange.asResolvedBody(createBody);

    const response = await accountsApi.actions.restoreAccountForCookie(
      grantee.cookieHeader,
      accountId,
      owner.userId,
    );
    await accountsApi.assert.statusIs(response, 403);
  });

  test("[shared-context→POST /accounts/:id/purge]: grantee + x-context-user-id=owner → 403", async ({
    request,
    accountsApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "account-lifecycle-shared-purge-owner-sub",
      email: "purge-owner@example.com",
      name: "Purge Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "account-lifecycle-shared-purge-grantee-sub",
      email: "purge-grantee@example.com",
      name: "Purge Grantee",
      role: "member",
    });

    const created = await accountsApi.actions.createAccountForCookie(
      owner.cookieHeader,
      {
        name: "Purge Context Target",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    );
    const createdBody = (await accountsApi.arrange.body(created)) as Record<string, unknown>;
    const accountId = String(createdBody.id);

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    sharesApi.arrange.asResolvedBody(createBody);

    const response = await accountsApi.actions.permanentlyDeleteAccountForCookie(
      grantee.cookieHeader,
      accountId,
      "Purge Context Target",
      owner.userId,
    );
    await accountsApi.assert.statusIs(response, 403);
  });

  // ── Shared-context grantee on the READ endpoint ─────────────────────────
  // The Recently-deleted listing is a READ; the grantee should be able to
  // see the owner's deleted list via context-switch (this is the canonical
  // "read someone else's view" use case the switcher enables).

  test("[shared-context→GET /accounts/deleted]: grantee + x-context-user-id=owner can read owner's deleted list → 200", async ({
    request,
    accountsApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "account-lifecycle-shared-read-owner-sub",
      email: "read-owner@example.com",
      name: "Read Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "account-lifecycle-shared-read-grantee-sub",
      email: "read-grantee@example.com",
      name: "Read Grantee",
      role: "member",
    });

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    sharesApi.arrange.asResolvedBody(createBody);

    const response = await accountsApi.actions.listDeletedAccountsForCookie(
      grantee.cookieHeader,
      owner.userId,
    );
    await accountsApi.assert.statusIs(response, 200);
  });
});
