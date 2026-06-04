// Render KZO-197 Provider Console V2 locked mockup states to PNG screenshots.
// Run from repo root:
//   node docs/004-notes/kzo-197/provider-console-v2/mockups/version-2/render-provider-console-v2-locked.mjs
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "provider-console-v2-locked-mockup.html");
const outDir = path.resolve(here, "screenshots");

const desktop = { width: 1440, height: 1080 };
const desktopTall = { width: 1440, height: 1360 };
const mobile = { width: 390, height: 1280 };

const screenshots = [
  ["01-provider-console-overview-desktop.png", "overview", desktop],
  ["02-provider-tabs-capabilities-desktop.png", "provider-tabs-capabilities", desktop],
  ["03-provider-fixer-coverage-desktop.png", "provider-fixer-coverage", desktopTall],
  ["04-unresolved-instruments-desktop.png", "unresolved", desktop],
  ["05-fixer-normal-actions-desktop.png", "fixer", desktop],
  ["06-dangerous-preview-desktop.png", "dangerous-preview", desktop],
  ["07-operations-running-sse-desktop.png", "operations", desktop],
  ["08-operations-queued-desktop.png", "operations-queued", desktop],
  ["09-operation-outcomes-desktop.png", "operation-outcomes", desktop],
  ["10-incidents-activity-logs-desktop.png", "incidents-activity-logs", desktop],
  ["11-logs-purge-preview-desktop.png", "logs-purge-preview", desktop],
  ["12-kr-mappings-desktop.png", "mappings", desktop],
  ["13-settings-provider-budgets-desktop.png", "settings", desktopTall],
  ["14-settings-retention-desktop.png", "settings-retention", desktop],
  ["15-mobile-provider-overview.png", "mobile-overview", mobile],
  ["16-mobile-provider-switcher.png", "mobile-provider-switcher", mobile],
  ["17-mobile-unresolved.png", "mobile-unresolved", mobile],
  ["18-mobile-operation-progress.png", "mobile-operations", mobile],
  ["19-mobile-dangerous-preview.png", "mobile-dangerous-preview", mobile]
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
