import { NormalClick } from "./click.js";
import { NormalFill } from "./fill.js";
import { NormalSelect } from "./select.js";
import { WaitForVisible } from "./wait.js";

import type { TActionLogger, TUIActions } from "../core/types.js";

export interface TCreateUIActionsOptions {
  logger?: TActionLogger;
}

export function createUIActions(options: TCreateUIActionsOptions = {}): TUIActions {
  const logger = options.logger ?? console;

  return {
    click: new NormalClick(logger),
    fill: new NormalFill(logger),
    select: new NormalSelect(logger),
    wait: new WaitForVisible(logger),
  };
}

export const defaultUIActions = createUIActions();

export * from "./click.js";
export * from "./fill.js";
export * from "./select.js";
export * from "./wait.js";
