// Snapshots the KZO-169 mockup HTML to PNG via Playwright.
// Run from the repo root: `node docs/004-notes/kzo-169/mockup-202604300100-render.mjs`
// Mirrors the KZO-179 / KZO-168 mockup-render pattern.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "mockup-202604300100-market-code-selector.html");
const out = path.resolve(here, "mockup-202604300100-market-code-selector.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 2 });
await page.goto(`file://${html}`, { waitUntil: "networkidle" });
await page.waitForTimeout(300); // let webfonts settle
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`wrote ${out}`);
