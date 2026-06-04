// Render KZO-197 Provider Console V2 mockup states to PNG screenshots.
// Run from repo root:
//   node docs/004-notes/kzo-197/provider-console-v2/mockups/render-provider-console-v2.mjs
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "provider-console-v2-mockup.html");
const outDir = path.resolve(here, "screenshots");

const desktop = { width: 1440, height: 1080 };
const mobile = { width: 390, height: 1280 };

const screenshots = [
  ["01-provider-console-overview-desktop.png", "overview", desktop],
  ["02-unresolved-instruments-desktop.png", "unresolved", desktop],
  ["03-provider-fixer-desktop.png", "fixer", desktop],
  ["04-dangerous-preview-desktop.png", "dangerous-preview", desktop],
  ["05-operations-running-desktop.png", "operations", desktop],
  ["06-operation-outcomes-desktop.png", "operation-outcomes", desktop],
  ["07-incidents-activity-logs-desktop.png", "incidents-activity-logs", desktop],
  ["08-kr-mappings-desktop.png", "mappings", desktop],
  ["09-provider-operations-settings-desktop.png", "settings", desktop],
  ["10-mobile-unresolved.png", "mobile-unresolved", mobile],
  ["11-mobile-dangerous-preview.png", "mobile-dangerous-preview", mobile]
];

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [filename, screen, viewport] of screenshots) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`file://${html}?screen=${screen}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const out = path.join(outDir, filename);
    await page.screenshot({ path: out, fullPage: viewport.width >= 820 });
    await context.close();
    console.log("Saved:", out);
  }
} finally {
  await browser.close();
}
