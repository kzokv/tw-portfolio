import type { Locator } from "@playwright/test";

import type { TActionLogger, TFillAction, TFillActionOptions } from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

const SENSITIVE_MASK = "********";

export class NormalFill implements TFillAction {
  constructor(private readonly logger: TActionLogger = console) {}

  async perform(locator: Locator, value: string, options: TFillActionOptions = {}): Promise<void> {
    const { sensitive = false, ...fillOptions } = options;
    const displayValue = sensitive ? SENSITIVE_MASK : value;
    this.logger.info(`[fill] ${describeLocator(locator)} <= ${displayValue}`);
    await locator.fill(value, fillOptions);
  }
}
