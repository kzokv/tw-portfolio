import { test } from "../fixtures.js";
import { createDemoSession } from "./helpers/sharing.js";

test.describe("sharing demo guard", () => {
  test("[sharing grant]: demo session attempts grant → forbidden", async ({ request, sharesApi }) => {
    const demo = await createDemoSession(request);

    const response = await sharesApi.actions.createShareForCookie(demo.cookieHeader, "demo-target@example.com");
    await sharesApi.assert.statusIs(response, 403);
    const body = await response.json() as Record<string, unknown>;
    await sharesApi.assert.fieldEquals(body, "error", "share_grant_forbidden");
  });
});
