import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TestEnv } from "@tw-portfolio/config/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, "../.auth/oauth-session.json");

setup("authenticate with Google OAuth", async ({ page }) => {
  setup.setTimeout(300_000); // 5 min — enough time for manual Google login

  if (fs.existsSync(authFile)) {
    console.log("Saved auth state found at .auth/oauth-session.json — skipping manual login.");
    return;
  }

  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  console.log("\n=======================================================");
  console.log("MANUAL LOGIN REQUIRED");
  console.log("Please sign in with: mmckchuang@gmail.com");
  console.log("The browser will open the login page now.");
  console.log("=======================================================\n");

  await page.goto("/login");
  await expect(page.getByTestId("google-sign-in-button")).toBeVisible({ timeout: 15_000 });

  // Wait until the browser returns to the local app on any path other than /login.
  // The hostname check (localhost or 127.0.0.1) is essential: while Google's OAuth UI
  // is open, the URL is accounts.google.com — keep waiting until the API callback
  // redirects the browser back to the local web app.
  const localHostnames = new Set(["localhost", "127.0.0.1"]);
  await page.waitForURL(
    (url) => localHostnames.has(url.hostname) && url.pathname !== "/login",
    { timeout: 180_000 },
  );

  // Verify session cookie was actually set — a missing cookie means the flow failed
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === TestEnv.sessionCookieName);
  if (!sessionCookie) {
    throw new Error(
      `OAuth flow completed but ${TestEnv.sessionCookieName} cookie is missing — did you sign in with the correct account?`,
    );
  }


  await page.context().storageState({ path: authFile });
  console.log(`\nAuth state saved to ${authFile}`);
});
