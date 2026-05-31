import { getMemberName } from "./ast.js";

// Banned raw Playwright actions — assistants must route these through the
// matching `uiActions.X.perform` or `mxX` mixin so logging/tracing applies
// uniformly. Keep this set in sync with `ActionsMixin` shortcuts:
//   click   → mxClick / uiActions.click.perform
//   fill    → mxFill  / uiActions.fill.perform
//   hover   → mxHover / uiActions.hover.perform
//   press   → mxPressKey (page.keyboard.press) — no Locator-level wrapper
//   focus   → mxFocus
//   check   → mxCheck
//   uncheck → mxUncheck
//   dragTo  → mxDragTo
const RAW_ACTIONS = new Set([
  "check",
  "click",
  "dragTo",
  "fill",
  "focus",
  "hover",
  "press",
  "uncheck",
]);

export const noRawAction = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent raw Playwright actions in assistants.",
      url: "https://github.com/anthropics/tw-portfolio/blob/dev/docs/004-notes/automation-refactor/scope-todo-202604251545-aaa-pom-compliance.md",
    },
    messages: {
      rawAction: "Route raw Playwright actions through `uiActions` or an `mx*` mixin.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee?.type !== "MemberExpression") {
          return;
        }

        if (!RAW_ACTIONS.has(getMemberName(node.callee))) {
          return;
        }

        context.report({ node: node.callee, messageId: "rawAction" });
      },
    };
  },
};
