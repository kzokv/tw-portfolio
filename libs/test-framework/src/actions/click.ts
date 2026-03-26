import type { Locator } from "@playwright/test";

import type { TActionLogger, TClickAction } from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

export class NormalClick implements TClickAction {
  constructor(private readonly logger: TActionLogger = console) {}

  async perform(locator: Locator, options = {}): Promise<void> {
    this.logger.info(`[click] ${describeLocator(locator)}`);
    await locator.click(options);
  }
}
