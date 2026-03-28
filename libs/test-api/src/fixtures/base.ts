import { test as base, expect } from "@playwright/test";
import { buildApiUserFixtures, type TApiBaseFixtures } from "./shared.js";

export const test = base.extend<TApiBaseFixtures>({
  ...buildApiUserFixtures(true),
});

export { expect };
