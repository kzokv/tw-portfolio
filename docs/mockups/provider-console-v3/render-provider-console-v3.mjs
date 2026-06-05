// Render focused Provider Console V3 mockup states to PNG screenshots.
// Run from repo root:
//   node docs/mockups/provider-console-v3/render-provider-console-v3.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "provider-console-v3-mockup.html");
const desktop = { width: 1440, height: 1080 };
const mobile = { width: 390, height: 1120 };

const screenshots = [
  ["01-unresolved-no-selection-desktop.png", "unresolved-no-selection", desktop],
  ["02-unresolved-visible-selected-desktop.png", "unresolved-visible-selected", desktop],
  ["03-unresolved-all-matching-desktop.png", "unresolved-all-matching", desktop],
  ["04-fixer-no-scope-desktop.png", "fixer-no-scope", desktop],
  ["05-fixer-preparing-preview-desktop.png", "fixer-preparing-preview", desktop],
  ["06-fixer-preview-checklist-desktop.png", "fixer-preview-checklist", desktop],
  ["07-operations-live-progress-desktop.png", "operations-live-progress", desktop],
  ["08-unresolved-selection-mobile.png", "unresolved-selection-mobile", mobile],
];

const browser = await chromium.launch();
try {
  for (const [filename, screen, viewport] of screenshots) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`file://${html}?screen=${screen}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(here, filename), fullPage: viewport.width >= 820 });
    await context.close();
    console.log(`Saved ${filename}`);
  }
} finally {
  await browser.close();
}
