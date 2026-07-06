import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, "unrealized-pnl-basis-mockups.html");

const targets = [
  ["reports-basis", "reports-basis-disclosure.png"],
  ["analysis-details", "analysis-details-basis-total.png"],
  ["analysis-chart", "analysis-chart-axis-zero.png"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 940 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(sourcePath).href);

for (const [screenName, outputName] of targets) {
  const locator = page.locator(`[data-screen="${screenName}"]`);
  await locator.screenshot({ path: join(here, outputName) });
}

await browser.close();
