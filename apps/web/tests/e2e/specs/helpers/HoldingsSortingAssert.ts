import { expect, type Locator, type Response } from "@playwright/test";

export class HoldingsSortingAssert {
  async ariaSort(sortButton: Locator, direction: "ascending" | "descending"): Promise<void> {
    await expect(sortButton.locator("xpath=ancestor::th")).toHaveAttribute("aria-sort", direction);
  }

  async containsText(locator: Locator, expected: RegExp): Promise<void> {
    await expect(locator).toContainText(expected);
  }

  async hasNoAriaSort(sortButton: Locator): Promise<void> {
    await expect(sortButton.locator("xpath=ancestor::th")).not.toHaveAttribute("aria-sort");
  }

  async isVisible(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
  }

  async preferencePatchSucceeded(response: Response): Promise<void> {
    expect(response.ok(), `PATCH /user-preferences: ${response.status()}`).toBe(true);
  }

  async preferencePatchHasIsolatedSort(
    patch: Record<string, unknown>,
    contextKey: string,
    expected: { sortDirection: string; sortField: string; sortMode: string },
    absentContextKey: string,
  ): Promise<void> {
    const typedPatch = patch as {
      holdingsTableSettings?: { contexts?: Record<string, Record<string, unknown>> };
    };
    expect(typedPatch.holdingsTableSettings?.contexts?.[contextKey]).toMatchObject(expected);
    expect(typedPatch.holdingsTableSettings?.contexts?.[absentContextKey]).toBeUndefined();
  }

  async testIdOrder(locator: Locator, expected: string[]): Promise<void> {
    await expect.poll(async () => locator.evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute("data-testid"))
    ))).toEqual(expected);
  }
}
