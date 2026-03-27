import type { Locator } from "@playwright/test";

import type { TActionLogger, TClickAction } from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

export class NormalClick implements TClickAction {
  constructor(private readonly logger: TActionLogger) {}

  async perform(locator: Locator, options = {}): Promise<void> {
    const actionLabel = `[click] ${describeLocator(locator)}`;
    this.logger.info(actionLabel);
    try {
      await locator.click(options);
    } finally {
      this.logger.logDrainedErrors(actionLabel);
    }
  }
}
