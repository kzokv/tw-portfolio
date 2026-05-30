/**
 * oauthBase — per-test OAuth session fixture for specs-oauth/ tests.
 * Mints a session via /__e2e/oauth-session and plants it as a browser cookie.
 * Provides testUser (with page) for createWebFixture to work.
 */
import { createSessionTest } from "./sessionBase.js";

export const test = createSessionTest("oauth");

export { expect } from "@playwright/test";
