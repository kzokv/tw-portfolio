import type { Locator } from "@playwright/test";

import type {
  TActionLogger,
  TWaitForVisibleAction,
  TWaitForVisibleOptions,
} from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

export class WaitForVisible implements TWaitForVisibleAction {
  constructor(private readonly logger: TActionLogger) {}

  async perform(locator: Locator, options: TWaitForVisibleOptions = {}): Promise<void> {
    const actionLabel = `[wait] ${describeLocator(locator)} visible`;
    this.logger.info(actionLabel);
    try {
      await locator.waitFor(
        options.timeout === undefined
          ? { state: "visible" }
          : { state: "visible", timeout: options.timeout },
      );
    } finally {
      this.logger.logDrainedErrors(actionLabel);
    }
  }
}
