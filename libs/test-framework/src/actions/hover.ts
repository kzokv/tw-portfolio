import type { Locator } from "@playwright/test";

import type { TActionLogger, THoverAction } from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

export class NormalHover implements THoverAction {
  constructor(private readonly logger: TActionLogger) {}

  async perform(locator: Locator, options = {}): Promise<void> {
    const actionLabel = `[hover] ${describeLocator(locator)}`;
    this.logger.info(actionLabel);
    try {
      await locator.hover(options);
    } finally {
      this.logger.logDrainedErrors(actionLabel);
    }
  }
}
