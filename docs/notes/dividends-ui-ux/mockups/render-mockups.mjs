import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, "mockup.html");
const outputDir = path.join(__dirname, "screenshots");

const cases = [
  {
    hash: "dashboard",
    name: "dashboard-progress-desktop.png",
    viewport: { width: 1440, height: 920 },
  },
  {
    hash: "dashboard",
    name: "dashboard-progress-mobile.png",
    viewport: { width: 390, height: 1040 },
  },
  {
    hash: "dividends",
    name: "dividends-overview-desktop.png",
    viewport: { width: 1440, height: 1120 },
  },
  {
    hash: "dividends",
    name: "dividends-overview-mobile.png",
    viewport: { width: 390, height: 1180 },
  },
  {
    hash: "ticker",
    name: "ticker-dividends-desktop.png",
    viewport: { width: 1440, height: 1120 },
  },
  {
    hash: "ticker",
    name: "ticker-dividends-mobile.png",
    viewport: { width: 390, height: 1180 },
  },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage();

  for (const shot of cases) {
    await page.setViewportSize(shot.viewport);
    await page.goto(`${pathToFileURL(htmlPath).href}#${shot.hash}`, { waitUntil: "networkidle" });
    await page.evaluate((view) => {
      document.body.dataset.view = view;
    }, shot.hash);
    await page.screenshot({
      path: path.join(outputDir, shot.name),
      fullPage: true,
      animations: "disabled",
    });
  }
} finally {
  await browser.close();
}

console.log(
  cases
    .map((shot) => path.join(outputDir, shot.name))
    .join("\n"),
);
