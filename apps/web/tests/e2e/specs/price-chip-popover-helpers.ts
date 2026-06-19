import { expect, type Locator, type Page } from "@playwright/test";

export async function resolveFirstVisibleByTestId(page: Page, testId: string, description: string): Promise<Locator> {
  const matches = page.getByTestId(testId).filter({ visible: true });
  await expect
    .poll(async () => matches.count(), { message: `${description} ${testId} becomes visible` })
    .toBeGreaterThan(0);
  return matches.nth(0);
}

export async function assertPriceChipDetailsPopover(
  page: Page,
  chip: Locator,
  description: string,
  trigger: "click" | "hover" | "tap" = "click",
): Promise<void> {
  await chip.waitFor({ state: "visible" });
  if (trigger === "hover") {
    await chip.hover();
  } else if (trigger === "tap") {
    await chip.tap();
  } else {
    await chip.click();
  }

  const popover = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ hasText: "Basis:" });
  await expect(popover, `${description} opens one price-state details popover`).toHaveCount(1);
  await expect(popover, `${description} includes basis`).toContainText("Basis:");
  await expect(popover, `${description} includes market state`).toContainText("Market:");
  await expect(popover, `${description} includes source`).toContainText("Source:");
  await expect(popover, `${description} includes quality`).toContainText("Quality:");
  await expect(popover, `${description} includes time zone`).toContainText("Time zone:");

  await expect.poll(
    async () => {
      const box = await popover.boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) return `${description} missing layout box`;
      if (box.x < -1) return `${description} popover left edge is outside viewport: ${box.x}`;
      if (box.y < -1) return `${description} popover top edge is outside viewport: ${box.y}`;
      if (box.x + box.width > viewport.width + 1) {
        return `${description} popover right edge ${box.x + box.width} exceeds viewport ${viewport.width}`;
      }
      if (box.y + box.height > viewport.height + 1) {
        return `${description} popover bottom edge ${box.y + box.height} exceeds viewport ${viewport.height}`;
      }
      return "ready";
    },
    { message: `${description} popover stays inside the viewport` },
  ).toBe("ready");

  await page.keyboard.press("Escape");
  await expect(popover, `${description} popover closes after ${trigger}`).toHaveCount(0);
}
