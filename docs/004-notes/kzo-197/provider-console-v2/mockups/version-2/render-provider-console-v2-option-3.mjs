// Render KZO-197 Provider Console V2 option 3 mockup states to PNG screenshots.
// Run from repo root:
//   node docs/004-notes/kzo-197/provider-console-v2/mockups/version-2/render-provider-console-v2-option-3.mjs
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "provider-console-v2-option-3-mockup.html");
const outDir = path.resolve(here, "screenshots");

const desktop = { width: 1440, height: 1080 };
const mobile = { width: 390, height: 1280 };

const screenshots = [
  ["01-provider-console-overview-desktop.png", "overview", desktop],
  ["02-unresolved-instruments-desktop.png", "unresolved", desktop],
  ["03-select-all-matching-desktop.png", "select-all-matching", desktop],
  ["04-provider-fixer-desktop.png", "fixer", desktop],
  ["05-ambiguous-candidate-selection-desktop.png", "candidate-selection", desktop],
  ["06-dangerous-repair-preview-desktop.png", "dangerous-preview", desktop],
  ["07-operations-running-desktop.png", "operations", desktop],
  ["08-operation-outcomes-desktop.png", "operation-outcomes", desktop],
  ["09-incidents-desktop.png", "incidents", desktop],
  ["10-activity-logs-purge-desktop.png", "activity-logs-purge", desktop],
  ["11-kr-mappings-desktop.png", "mappings", desktop],
  ["12-provider-operations-settings-desktop.png", "settings", desktop],
  ["13-finmind-shared-budget-desktop.png", "finmind-shared-budget", desktop],
  ["14-twelve-data-capability-evidence-desktop.png", "twelve-data-capability", desktop],
  ["15-yahoo-finance-au-rerun-desktop.png", "yahoo-au-rerun", desktop],
  ["16-twelve-data-au-catalog-desktop.png", "twelve-data-au-catalog", desktop],
  ["17-asx-gics-csv-enrichment-desktop.png", "asx-gics-csv", desktop],
  ["18-frankfurter-fx-refresh-desktop.png", "frankfurter-fx", desktop],
  ["19-mobile-unresolved.png", "mobile-unresolved", mobile],
  ["20-mobile-fixer-action-sheet.png", "mobile-fixer-action-sheet", mobile],
  ["21-mobile-dangerous-preview.png", "mobile-dangerous-preview", mobile]
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
