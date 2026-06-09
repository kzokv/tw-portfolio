import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlUrl = pathToFileURL(path.join(root, "reports-mockup.html")).href;
const outputDir = path.join(root, "screenshots");

const captures = [
  { report: "dashboard", name: "dashboard-desktop.png", viewport: { width: 1440, height: 1300 } },
  { report: "dashboard", name: "dashboard-mobile.png", viewport: { width: 390, height: 1400 } },
  { report: "holding-focus", name: "holding-focus-desktop.png", viewport: { width: 1440, height: 1300 } },
  { report: "holding-focus", name: "holding-focus-mobile.png", viewport: { width: 390, height: 1600 } },
  { report: "daily", name: "daily-review-desktop.png", viewport: { width: 1440, height: 1200 } },
  { report: "daily", name: "daily-review-mobile.png", viewport: { width: 390, height: 1100 } },
  { report: "portfolio", name: "portfolio-report-desktop.png", viewport: { width: 1440, height: 1500 } },
  { report: "portfolio", name: "portfolio-report-mobile.png", viewport: { width: 390, height: 1500 } },
  { report: "market", name: "market-report-desktop.png", viewport: { width: 1440, height: 1300 } },
  { report: "market", name: "market-report-mobile.png", viewport: { width: 390, height: 1300 } },
  { report: "portfolio-loading", name: "portfolio-loading-desktop.png", viewport: { width: 1440, height: 1200 } },
  { report: "portfolio-loading", name: "portfolio-loading-mobile.png", viewport: { width: 390, height: 1300 } },
  { report: "ticker", name: "ticker-detail-desktop.png", viewport: { width: 1440, height: 1300 } },
  { report: "ticker", name: "ticker-detail-mobile.png", viewport: { width: 390, height: 1400 } },
];

const reportFilter = new Set(
  (process.env.REPORTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

try {
  const browser = await chromium.launch();
  try {
    for (const capture of captures) {
      if (reportFilter.size > 0 && !reportFilter.has(capture.report)) continue;
      const page = await browser.newPage({ viewport: capture.viewport, deviceScaleFactor: 1 });
      await page.goto(`${htmlUrl}?report=${capture.report}`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: path.join(outputDir, capture.name),
        fullPage: true,
      });
      await page.close();
      console.log(capture.name);
    }
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
