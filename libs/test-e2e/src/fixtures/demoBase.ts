/**
 * demoBase — per-test demo session fixture.
 * Mints a session via /__e2e/demo-session (bypasses rate limiter) and plants it
 * as a browser cookie. Provides testUser for createWebFixture to work.
 */
import { createSessionTest } from "./sessionBase.js";

export const test = createSessionTest("demo");

export { expect } from "@playwright/test";
