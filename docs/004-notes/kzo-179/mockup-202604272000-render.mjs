// Snapshots the KZO-179 mockup HTML to PNG via Playwright.
// Run from the repo root: `node docs/004-notes/kzo-179/mockup-202604272000-render.mjs`
// Mirrors the KZO-158 / KZO-167 mockup-render pattern.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "mockup-202604272000-account-creation.html");
const out = path.resolve(here, "mockup-202604272000-account-creation.png");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1700 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto("file://" + html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("Saved:", out);
