import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlUrl = pathToFileURL(path.join(root, "viewer-scoped-owner-portfolio-settings.html")).href;

const shots = [
  {
    name: "viewer-scoped-owner-portfolio-settings-desktop.png",
    viewport: { width: 1440, height: 980 },
  },
  {
    name: "viewer-scoped-owner-portfolio-settings-mobile.png",
    viewport: { width: 390, height: 980 },
  },
];

const browser = await chromium.launch();
try {
  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: shot.viewport,
      deviceScaleFactor: 1,
    });
    await page.goto(htmlUrl, { waitUntil: "networkidle" });
    const outputPath = path.join(root, shot.name);
    await page.screenshot({ path: outputPath, fullPage: true });
    await page.close();
    console.log(outputPath);
  }
} finally {
  await browser.close();
}
