import { test, expect } from "../fixtures/oauth-base";
import { apiUrl, TestEnv } from "../helpers/flows";

/**
 * Build a fake id_token JWT payload for deterministic profile seeding.
 * The __e2e/oauth-session endpoint only decodes the base64url payload — no
 * signature verification — so a mock token with fixed claims works fine.
 */
function makeDeterministicIdToken(overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "profile-e2e-sub",
      email: "profile-e2e@example.com",
      email_verified: true,
      name: "Profile E2E User",
      picture: "https://lh3.googleusercontent.com/profile-e2e.jpg",
      iss: "https://accounts.google.com",
      aud: "e2e-test-client-id",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    }),
  ).toString("base64url");
  return `${header}.${payload}.mock-sig`;
}

/**
 * Helper: seed a deterministic profile user and plant the session cookie.
 * Returns the userId for assertions.
 */
async function seedProfileUser(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  idTokenOverrides?: Record<string, unknown>,
): Promise<string> {
  const idToken = makeDeterministicIdToken(idTokenOverrides);
  const res = await request.post(apiUrl("/__e2e/oauth-session"), {
    data: { id_token: idToken },
  });
  expect(res.ok()).toBeTruthy();

  const body = (await res.json()) as { userId: string };
  const setCookieHeader = res.headers()["set-cookie"] ?? "";
  const cookieName = TestEnv.sessionCookieName;
  const match = setCookieHeader.match(new RegExp(`${cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`));
  expect(match).toBeTruthy();

  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: cookieName,
      value: match![1],
      domain: TestEnv.host,
      path: "/",
      httpOnly: true,
      secure: cookieName.startsWith("__Host-"),
      sameSite: "Lax",
    },
  ]);

  return body.userId;
}

test.describe("profile tab in settings drawer", () => {
  // E1: Profile tab visible in settings drawer
  test("profile tab button is visible in settings drawer", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await expect(page.getByTestId("settings-drawer")).toBeVisible();
    await expect(page.getByTestId("settings-tab-profile")).toBeVisible();
  });

  // E2: Profile tab content is accessible
  test("clicking profile tab shows profile section", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await expect(page.getByTestId("settings-drawer")).toBeVisible();

    await page.getByTestId("settings-tab-profile").click();
    await expect(page.getByTestId("profile-section")).toBeVisible();
  });

  // E3: Display name shown as read-only
  test("display name input is read-only with a value", async ({ page, request }) => {
    await seedProfileUser(page, request);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await page.getByTestId("settings-tab-profile").click();
    await expect(page.getByTestId("profile-section")).toBeVisible();

    const displayNameInput = page.getByTestId("profile-display-name-input");
    await expect(displayNameInput).toBeVisible();
    await expect(displayNameInput).toHaveAttribute("readonly", "");
    await expect(displayNameInput).toHaveValue("Profile E2E User");
  });

  // E4: Google attribution note visible
  test("Google attribution note is visible near display name", async ({ page, request }) => {
    await seedProfileUser(page, request);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await page.getByTestId("settings-tab-profile").click();
    await expect(page.getByTestId("profile-section")).toBeVisible();

    // The attribution text appears both as tooltip content and as a note below the input.
    // Check for the visible text note (English or zh-TW).
    const profileSection = page.getByTestId("profile-section");
    await expect(
      profileSection.getByText(/Google/i),
    ).toBeVisible();
  });

  // E5: Email field is editable
  test("email input accepts typing", async ({ page, request }) => {
    await seedProfileUser(page, request);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await page.getByTestId("settings-tab-profile").click();

    const emailInput = page.getByTestId("profile-email-input");
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveValue("profile-e2e@example.com");

    // Clear and type a new value
    await emailInput.clear();
    await emailInput.fill("new-email@example.com");
    await expect(emailInput).toHaveValue("new-email@example.com");
  });

  // E6: Email saves successfully via PATCH
  test("email saves and shows success indicator", async ({ page, request }) => {
    await seedProfileUser(page, request);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await page.getByTestId("settings-tab-profile").click();

    const emailInput = page.getByTestId("profile-email-input");
    await emailInput.clear();
    const newEmail = `e2e-saved-${Date.now()}@example.com`;
    await emailInput.fill(newEmail);

    // Wait for PATCH response when clicking save
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes("/api/profile") && res.request().method() === "PATCH",
    );

    await page.getByTestId("profile-save-email").click();
    const patchRes = await patchPromise;
    expect(patchRes.ok()).toBeTruthy();

    // Success indicator should appear
    await expect(page.getByTestId("profile-email-saved")).toBeVisible();
  });

  // E7: Email persists after drawer close and reopen
  test("saved email persists after closing and reopening drawer", async ({ page, request }) => {
    await seedProfileUser(page, request);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    // Open settings, go to profile tab, change email
    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await page.getByTestId("settings-tab-profile").click();

    const emailInput = page.getByTestId("profile-email-input");
    await emailInput.clear();
    const persistedEmail = `e2e-persist-${Date.now()}@example.com`;
    await emailInput.fill(persistedEmail);

    const patchPromise = page.waitForResponse(
      (res) => res.url().includes("/api/profile") && res.request().method() === "PATCH",
    );
    await page.getByTestId("profile-save-email").click();
    await patchPromise;
    await expect(page.getByTestId("profile-email-saved")).toBeVisible();

    // Close drawer by clicking outside or pressing escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-drawer")).toBeHidden();

    // Reopen and verify
    await page.getByTestId("avatar-button").click();
    await page.getByTestId("avatar-menu-settings").click();
    await expect(page.getByTestId("settings-drawer")).toBeVisible();
    await page.getByTestId("settings-tab-profile").click();

    await expect(page.getByTestId("profile-email-input")).toHaveValue(persistedEmail);
  });
});

test.describe("avatar identity display", () => {
  // E8: Avatar shows picture or initials (not UUID)
  test("avatar button shows picture when user has providerPictureUrl", async ({ page, request }) => {
    // Intercept the fake Google CDN image so it loads successfully —
    // without this, the 404 triggers onError and the component falls back to initials
    await page.route("**/profile-e2e.jpg", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"),
      }),
    );
    await seedProfileUser(page, request);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    const avatarButton = page.getByTestId("avatar-button");
    await expect(avatarButton).toBeVisible();

    // With a seeded picture URL, the avatar should render an <img> tag
    const img = avatarButton.locator("img");
    await expect(img).toBeVisible();
    expect(await img.getAttribute("src")).toContain("profile-e2e.jpg");
  });

  test("avatar button shows initials when user has no picture", async ({ page, request }) => {
    await seedProfileUser(page, request, { picture: undefined });
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    const avatarButton = page.getByTestId("avatar-button");
    await expect(avatarButton).toBeVisible();

    // No <img> tag — should show initials derived from display name "Profile E2E User" → "PE"
    const img = avatarButton.locator("img");
    await expect(img).toHaveCount(0);

    // The initials span should contain uppercase letters (not a UUID fragment)
    const initialsSpan = avatarButton.locator("span[aria-hidden='true']");
    await expect(initialsSpan).toHaveText(/^[A-Z]{1,2}$/);
  });

  // E9: Avatar dropdown shows identity header
  test("avatar dropdown shows display name and email in identity header", async ({ page, request }) => {
    await seedProfileUser(page, request);
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: 30_000 });

    await page.getByTestId("avatar-button").click();

    const identity = page.getByTestId("avatar-menu-identity");
    await expect(identity).toBeVisible();
    await expect(identity).toContainText("Profile E2E User");
    await expect(identity).toContainText("profile-e2e@example.com");

    // Settings and Sign out items should still be present
    await expect(page.getByTestId("avatar-menu-settings")).toBeVisible();
    await expect(page.getByTestId("avatar-menu-sign-out")).toBeVisible();
  });
});
