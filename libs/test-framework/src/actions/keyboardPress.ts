import type { Page } from "@playwright/test";

import type { TActionLogger, TKeyboardPressAction } from "../core/types.js";

export class NormalKeyboardPress implements TKeyboardPressAction {
  constructor(private readonly logger: TActionLogger) {}

  async perform(page: Page, key: string, options = {}): Promise<void> {
    const actionLabel = `[keyboard.press] ${key}`;
    this.logger.info(actionLabel);
    try {
      await page.keyboard.press(key, options);
    } finally {
      this.logger.logDrainedErrors(actionLabel);
    }
  }
}
