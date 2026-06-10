import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlUrl = pathToFileURL(path.join(root, "frontend-redesign-reliability-mockup.html")).href;
const outputPath = path.join(root, "screenshots", "frontend-redesign-reliability-desktop.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1120 },
    deviceScaleFactor: 1,
  });
  await page.goto(htmlUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: outputPath, fullPage: true });
  await page.close();
  console.log(outputPath);
} finally {
  await browser.close();
}
