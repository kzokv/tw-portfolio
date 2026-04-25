import { NormalClick } from "./click.js";
import { NormalFill } from "./fill.js";
import { NormalHover } from "./hover.js";
import { NormalKeyboardPress } from "./keyboardPress.js";
import { NormalSelect } from "./select.js";
import { WaitForVisible } from "./wait.js";
import { ActionLogger } from "../logging/ActionLogger.js";

import type { TActionLogger, TUIActions } from "../core/types.js";

export interface TCreateUIActionsOptions {
  logger: TActionLogger;
}

export function createUIActions(options: TCreateUIActionsOptions): TUIActions {
  return {
    click: new NormalClick(options.logger),
    fill: new NormalFill(options.logger),
    hover: new NormalHover(options.logger),
    keyboardPress: new NormalKeyboardPress(options.logger),
    select: new NormalSelect(options.logger),
    wait: new WaitForVisible(options.logger),
  };
}

export const defaultUIActions = createUIActions({ logger: new ActionLogger({}) });

export * from "./click.js";
export * from "./fill.js";
export * from "./hover.js";
export * from "./keyboardPress.js";
export * from "./select.js";
export * from "./wait.js";
