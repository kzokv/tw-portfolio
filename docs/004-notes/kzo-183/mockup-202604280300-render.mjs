// Snapshots the KZO-183 mockup HTML to PNG via Playwright.
// Run from the repo root: `node docs/004-notes/kzo-183/mockup-202604280300-render.mjs`
// Mirrors the KZO-179 / KZO-167 / KZO-158 mockup-render pattern.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "mockup-202604280300-accounts-tab.html");
const out = path.resolve(here, "mockup-202604280300-accounts-tab.png");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 2200 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto("file://" + html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("Saved:", out);
