import type { Locator } from "@playwright/test";

import type {
  TActionLogger,
  TWaitForVisibleAction,
  TWaitForVisibleOptions,
} from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

export class WaitForVisible implements TWaitForVisibleAction {
  constructor(private readonly logger: TActionLogger = console) {}

  async perform(locator: Locator, options: TWaitForVisibleOptions = {}): Promise<void> {
    this.logger.info(`[wait] ${describeLocator(locator)} visible`);
    await locator.waitFor(
      options.timeout === undefined
        ? { state: "visible" }
        : { state: "visible", timeout: options.timeout },
    );
  }
}
