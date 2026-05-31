import type { Locator } from "@playwright/test";

import type { TLocatorWithDescribe } from "../core/types.js";

export function describeLocator(locator: Locator): string {
  const described = locator as TLocatorWithDescribe;

  if (typeof described.description === "function") {
    const label = described.description();
    if (label) {
      return label;
    }
  }

  return String(locator);
}
