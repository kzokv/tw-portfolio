import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing grant role guard", () => {
  test("[sharing grant]: viewer-role session attempts grant → write route forbidden", async ({ request, sharesApi }) => {
    const viewer = await createOauthSession(request, {
      sub: "sharing-viewer-blocked-sub",
      email: "viewer-blocked@example.com",
      name: "Viewer Blocked",
      role: "viewer",
    });

    const response = await sharesApi.actions.createShareForCookie(viewer.cookieHeader, "blocked-target@example.com");
    await sharesApi.assert.statusIs(response, 403);
    const body = await response.json() as Record<string, unknown>;
    await sharesApi.assert.fieldEquals(body, "error", "write_blocked_viewer_role");
  });
});
