import type { Locator } from "@playwright/test";

import type { TActionLogger, TFillAction, TFillActionOptions } from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

const SENSITIVE_MASK = "********";

export class NormalFill implements TFillAction {
  constructor(private readonly logger: TActionLogger) {}

  async perform(locator: Locator, value: string, options: TFillActionOptions = {}): Promise<void> {
    const { sensitive = false, ...fillOptions } = options;
    const displayValue = sensitive ? SENSITIVE_MASK : value;
    const actionLabel = `[fill] ${describeLocator(locator)} <= ${displayValue}`;
    this.logger.info(actionLabel);
    try {
      await locator.fill(value, fillOptions);
    } finally {
      this.logger.logDrainedErrors(actionLabel);
    }
  }
}
