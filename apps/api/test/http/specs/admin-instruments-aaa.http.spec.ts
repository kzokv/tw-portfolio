/**
 * KZO-195 — AAA HTTP coverage for `/admin/instruments` mutation routes.
 *
 *   POST /admin/instruments/:ticker/:marketCode/undelete   (admin-only)
 *   POST /admin/instruments/:ticker/:marketCode/exclude    (admin-only)
 *
 * Cases:
 *   [admin-undelete] admin → 200 (route + persistence land via Phase 5/7)
 *   [admin-exclude]  admin → 200 (toggle excluded=true)
 *   [non-admin-undelete] member → 403 with body.error="admin_role_required"
 *   [non-admin-exclude]  member → 403 with body.error="admin_role_required"
 *
 * Per `service-error-pattern.md`: assertions read `body.error` (NOT body.code).
 * Per `test-api-mapper-registration.md`: `AdminInstrumentsEndpoint` is
 * registered in `libs/test-api/src/config/mapper.ts`.
 *
 * NOTE (TDD-RED): these specs depend on the routes Phase 7 adds. Until the
 * backend lands them, the success-path requests will return 404 and the
 * 403-path assertion may instead see 404 (the HTTP-suite seeds neither the
 * row nor the route until impl lands). Tests are intentionally green-on-impl,
 * not green-on-stub.
 */

import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("admin instruments mutations (KZO-195)", () => {
  test("[admin-undelete]: admin can POST /admin/instruments/:ticker/:marketCode/undelete → 200", async ({
    request,
    adminInstrumentsApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "kzo195-admin-undelete-sub",
      email: "kzo195-admin-undelete@example.com",
      name: "KZO195 Admin Undelete",
      role: "admin",
    });

    const response = await adminInstrumentsApi.actions.undeleteForCookie(
      admin.cookieHeader,
      "AUDEL40",
      "AU",
    );
    await adminInstrumentsApi.assert.statusIs(response, 200);
    const body = await adminInstrumentsApi.arrange.instrumentBody(response);
    await adminInstrumentsApi.assert.tickerIs(body, "AUDEL40");
    await adminInstrumentsApi.assert.delistedAtIsNull(body);
  });

  test("[admin-exclude]: admin can POST /admin/instruments/:ticker/:marketCode/exclude → 200, toggles flag", async ({
    request,
    adminInstrumentsApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "kzo195-admin-exclude-sub",
      email: "kzo195-admin-exclude@example.com",
      name: "KZO195 Admin Exclude",
      role: "admin",
    });

    const response = await adminInstrumentsApi.actions.excludeForCookie(
      admin.cookieHeader,
      "AUDEL41",
      "AU",
      true,
    );
    await adminInstrumentsApi.assert.statusIs(response, 200);
    const body = await adminInstrumentsApi.arrange.instrumentBody(response);
    await adminInstrumentsApi.assert.tickerIs(body, "AUDEL41");
    await adminInstrumentsApi.assert.excludedIs(body, true);
  });

  test("[non-admin-undelete]: member → 403 with body.error='admin_role_required'", async ({
    request,
    adminInstrumentsApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "kzo195-member-undelete-sub",
      email: "kzo195-member-undelete@example.com",
      name: "KZO195 Member Undelete",
      role: "member",
    });

    const response = await adminInstrumentsApi.actions.undeleteForCookie(
      member.cookieHeader,
      "AUDEL42",
      "AU",
    );
    await adminInstrumentsApi.assert.statusIs(response, 403);
    const body = await adminInstrumentsApi.arrange.errorBody(response);
    // Per `service-error-pattern.md` — code lives at `body.error`, not `body.code`.
    await adminInstrumentsApi.assert.errorCodeIs(body, "admin_role_required");
  });

  test("[non-admin-exclude]: member → 403 with body.error='admin_role_required'", async ({
    request,
    adminInstrumentsApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "kzo195-member-exclude-sub",
      email: "kzo195-member-exclude@example.com",
      name: "KZO195 Member Exclude",
      role: "member",
    });

    const response = await adminInstrumentsApi.actions.excludeForCookie(
      member.cookieHeader,
      "AUDEL43",
      "AU",
      true,
    );
    await adminInstrumentsApi.assert.statusIs(response, 403);
    const body = await adminInstrumentsApi.arrange.errorBody(response);
    await adminInstrumentsApi.assert.errorCodeIs(body, "admin_role_required");
  });
});
