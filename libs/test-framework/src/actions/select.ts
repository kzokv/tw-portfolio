import type { Locator } from "@playwright/test";

import type { TActionLogger, TSelectAction } from "../core/types.js";

import { describeLocator } from "./describeLocator.js";

function formatSelection(values: Parameters<Locator["selectOption"]>[0]): string {
  if (values === null) {
    return "null";
  }

  if (Array.isArray(values)) {
    return values.map((value) => formatSelection(value)).join(", ");
  }

  if (typeof values === "string") {
    return values;
  }

  if ("label" in values || "value" in values || "index" in values) {
    return values.label ?? values.value ?? values.index?.toString() ?? "option";
  }

  return "element handle";
}

export class NormalSelect implements TSelectAction {
  constructor(private readonly logger: TActionLogger = console) {}

  async perform(
    locator: Locator,
    values: Parameters<Locator["selectOption"]>[0],
  ): Promise<void> {
    this.logger.info(`[select] ${describeLocator(locator)} <= ${formatSelection(values)}`);
    await locator.selectOption(values);
  }
}
