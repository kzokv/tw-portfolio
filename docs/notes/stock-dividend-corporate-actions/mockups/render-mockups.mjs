import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(dirname, "stock-dividend-ui-mockups.html");
const outputDir = path.join(dirname, "screenshots");

const desktopShots = [
  "holdings-overview",
  "holding-detail-timeline",
  "split-blocking-preview",
  "dividend-review-drawer",
];

const mobileShots = ["mobile-split-preview"];

async function capture(locator, outputPath) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: outputPath,
    animations: "disabled",
  });
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`file://${htmlPath}`);
  await page.evaluate(() => document.fonts.ready);

  for (const name of desktopShots) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture(page.locator(`[data-shot="${name}"]`), path.join(outputDir, `${name}.png`));
  }

  for (const name of mobileShots) {
    await page.setViewportSize({ width: 390, height: 900 });
    await capture(page.locator(`[data-shot="${name}"]`), path.join(outputDir, `${name}.png`));
  }
} finally {
  await browser.close();
}
