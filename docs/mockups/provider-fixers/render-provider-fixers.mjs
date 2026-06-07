// Render focused Provider Fixers mockup states to PNG screenshots.
// Run from repo root:
//   node docs/mockups/provider-fixers/render-provider-fixers.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "provider-fixers-mockup.html");
const desktop = { width: 1440, height: 1080 };
const mobile = { width: 390, height: 1040 };

const screenshots = [
  ["01-au-instruments-desktop.png", "au-instruments-desktop", desktop],
  ["02-au-instruments-mobile.png", "au-instruments-mobile", mobile],
  ["03-tw-backfill-desktop.png", "tw-backfill-desktop", desktop],
  ["04-tw-backfill-mobile.png", "tw-backfill-mobile", mobile],
  ["05-au-purge-desktop.png", "au-purge-desktop", desktop],
  ["06-au-purge-mobile.png", "au-purge-mobile", mobile],
  ["07-kr-mapping-desktop.png", "kr-mapping-desktop", desktop],
  ["08-kr-mapping-mobile.png", "kr-mapping-mobile", mobile],
];

const browser = await chromium.launch();
try {
  for (const [filename, screen, viewport] of screenshots) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`file://${html}?screen=${screen}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(here, filename), fullPage: viewport.width >= 820 });
    await context.close();
    console.log(`Saved ${filename}`);
  }
} finally {
  await browser.close();
}
