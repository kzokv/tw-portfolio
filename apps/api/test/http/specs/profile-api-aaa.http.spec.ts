import { UUID_V4_PATTERN } from "@tw-portfolio/test-framework/shared";
import { test } from "../fixtures.js";

test.describe("GET /profile and PATCH /profile", () => {
  test("GET /profile returns correct ProfileDto shape", async ({ profileApi }) => {
    const response = await profileApi.actions.getProfile();
    await profileApi.assert.statusIs(response, 200);
    const body = await profileApi.arrange.profileBody(response);
    await profileApi.assert.hasShape(body);
    await profileApi.assert.fieldMatches(body, "userId", UUID_V4_PATTERN);
  });

  test("GET /profile field values match seeded user", async ({ profileApi }) => {
    const response = await profileApi.actions.getProfile();
    await profileApi.assert.statusIs(response, 200);
    const body = await profileApi.arrange.profileBody(response);

    await profileApi.assert.fieldEquals(body, "email", "e2e-ci@e2e.local");
    await profileApi.assert.fieldEquals(body, "displayName", "E2E CI User");
    await profileApi.assert.fieldEquals(body, "providerDisplayName", "E2E CI User");
    await profileApi.assert.fieldIsNull(body, "providerPictureUrl");
  });

  test("GET /profile reflects claims from a custom id_token session", async ({ profileApi, sessionApi }) => {
    const sessionResponse = await sessionApi.actions.createOauthSessionForClaims({
      sub: "profile-test-sub",
      email: "profile@example.com",
      name: "Profile Test User",
      picture: "https://lh3.googleusercontent.com/profile-test.jpg",
    });
    await sessionApi.assert.statusIs(sessionResponse, 200);
    const cookieHeader = await sessionApi.arrange.sessionCookieHeader(sessionResponse);

    const response = await profileApi.actions.getProfileForCookie(cookieHeader);
    await profileApi.assert.statusIs(response, 200);
    const body = await profileApi.arrange.profileBody(response);

    await profileApi.assert.fieldEquals(body, "email", "profile@example.com");
    await profileApi.assert.fieldEquals(body, "displayName", "Profile Test User");
    await profileApi.assert.fieldEquals(
      body,
      "providerPictureUrl",
      "https://lh3.googleusercontent.com/profile-test.jpg",
    );
    await profileApi.assert.fieldEquals(body, "providerDisplayName", "Profile Test User");
  });

  test("GET /profile without session returns 401", async ({ profileApi }) => {
    const response = await profileApi.actions.getProfileUnauthenticated();
    await profileApi.assert.statusIs(response, 401);
  });

  test("PATCH /profile updates email", async ({ profileApi }) => {
    const patchResponse = await profileApi.actions.patchProfile({
      email: "new-email@example.com",
    });
    await profileApi.assert.statusIs(patchResponse, 200);
    const patchBody = await profileApi.arrange.profileBody(patchResponse);
    await profileApi.assert.fieldEquals(patchBody, "email", "new-email@example.com");

    const getResponse = await profileApi.actions.getProfile();
    await profileApi.assert.statusIs(getResponse, 200);
    const getBody = await profileApi.arrange.profileBody(getResponse);
    await profileApi.assert.fieldEquals(getBody, "email", "new-email@example.com");
  });

  test("PATCH /profile with invalid email returns 400", async ({ profileApi }) => {
    const response = await profileApi.actions.patchProfile({
      email: "not-an-email",
    });
    await profileApi.assert.statusIs(response, 400);
  });

  test("PATCH /profile without session returns 401", async ({ profileApi }) => {
    const response = await profileApi.actions.patchProfileUnauthenticated({
      email: "test@example.com",
    });
    await profileApi.assert.statusIs(response, 401);
  });

  test("PATCH /profile does NOT update provider fields", async ({ profileApi }) => {
    await profileApi.actions.patchProfile({ email: "changed@example.com" });

    const response = await profileApi.actions.getProfile();
    await profileApi.assert.statusIs(response, 200);
    const body = await profileApi.arrange.profileBody(response);

    await profileApi.assert.fieldEquals(body, "email", "changed@example.com");
    await profileApi.assert.fieldEquals(body, "providerDisplayName", "E2E CI User");
    await profileApi.assert.fieldIsNull(body, "providerPictureUrl");
  });

  test("GET /profile for user without provider picture returns null providerPictureUrl", async ({ profileApi }) => {
    const response = await profileApi.actions.getProfile();
    await profileApi.assert.statusIs(response, 200);
    const body = await profileApi.arrange.profileBody(response);

    await profileApi.assert.fieldMatches(body, "userId", UUID_V4_PATTERN);
    await profileApi.assert.fieldEquals(body, "email", "e2e-ci@e2e.local");
    await profileApi.assert.fieldEquals(body, "displayName", "E2E CI User");
    await profileApi.assert.fieldIsNull(body, "providerPictureUrl");
  });
});
