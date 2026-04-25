// Snapshots the KZO-161 mockup HTML to PNG via Playwright.
// Run from the repo root: `node docs/004-notes/kzo-158/mockup-202604241500-kzo-161-render.mjs`
// The mockup files live alongside this script in docs/004-notes/kzo-158/.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, 'mockup-202604241500-kzo-161-ui.html');
const out = path.resolve(here, 'mockup-202604241500-kzo-161-ui.png');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1600 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto('file://' + html, { waitUntil: 'networkidle' });
// Wait for fonts
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('Saved:', out);
