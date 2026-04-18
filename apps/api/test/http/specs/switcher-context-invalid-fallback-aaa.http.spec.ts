import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const dashboardOverviewUrl = new URL("/dashboard/overview", TestEnv.apiBaseUrl).href;

const CONTEXT_COOKIE_NAME = "tw_context_user_id";

test.describe("portfolio switcher: invalid context header fallback", () => {
  test("[switcher fallback]: malformed x-context-user-id falls back to session and stamps revoked header + clear-cookie", async ({
    request,
    sharesApi,
  }) => {
    const grantee = await createOauthSession(request, {
      sub: "switcher-invalid-grantee-sub",
      email: "switcher-invalid-grantee@example.com",
      name: "Switcher Invalid Grantee",
      role: "viewer",
    });

    const response = await request.get(dashboardOverviewUrl, {
      headers: {
        cookie: grantee.cookieHeader,
        "x-context-user-id": "not!valid",
      },
    });

    await sharesApi.assert.statusIs(response, 200);
    await sharesApi.assert.mxAssertEqual(
      response.headers()["x-context-fallback"],
      "revoked",
      "x-context-fallback header is revoked",
    );

    const setCookieHeader = response.headers()["set-cookie"] ?? "";
    await sharesApi.assert.mxAssertTruthy(
      setCookieHeader.includes(`${CONTEXT_COOKIE_NAME}=;`)
        && setCookieHeader.includes("Max-Age=0"),
      `set-cookie clears ${CONTEXT_COOKIE_NAME} (got: ${setCookieHeader})`,
    );

    const body = await response.json() as { summary: { holdingCount: number } };
    await sharesApi.assert.mxAssertEqual(
      body.summary.holdingCount,
      0,
      "summary.holdingCount is 0 (grantee has no portfolio data after fallback)",
    );
  });
});
