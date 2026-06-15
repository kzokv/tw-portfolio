import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlUrl = pathToFileURL(path.join(root, "sharing-delegated-capabilities.html")).href;
const outputDir = path.join(root, "screenshots");

const captures = [
  {
    view: "permissions",
    name: "edit-permissions-desktop.png",
    viewport: { width: 1440, height: 980 },
  },
  {
    view: "transactions",
    name: "shared-transaction-controls-desktop.png",
    viewport: { width: 1440, height: 980 },
  },
  {
    view: "accounts-mobile",
    name: "shared-account-management-mobile.png",
    viewport: { width: 430, height: 1040 },
  },
];

const browser = await chromium.launch();
try {
  for (const capture of captures) {
    const page = await browser.newPage({
      viewport: capture.viewport,
      deviceScaleFactor: 1,
    });
    await page.goto(`${htmlUrl}?view=${capture.view}`, { waitUntil: "networkidle" });
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
