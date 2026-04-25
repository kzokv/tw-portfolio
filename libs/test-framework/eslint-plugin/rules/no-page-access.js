import { getMemberName, isAllowedPageCall, isThisPage } from "./ast.js";

const ALLOWED_PAGE_METHODS = new Set([
  "context",
  "evaluate",
  "once",
  "route",
  "unroute",
  "url",
  "waitForLoadState",
  "waitForURL",
]);

const BANNED_PAGE_METHODS = new Set([
  "getByRole",
  "getByTestId",
  "getByText",
  "goto",
  "keyboard",
  "locator",
  "reload",
  "waitForResponse",
]);

export const noPageAccess = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent E2E assistants from bypassing page objects and AAA mixins.",
      url: "https://github.com/anthropics/tw-portfolio/blob/dev/docs/004-notes/automation-refactor/scope-todo-202604251545-aaa-pom-compliance.md",
    },
    messages: {
      pageAccess: "Route assistant page access through `this.el`, `uiActions`, or an `mx*` mixin.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!isThisPage(node.object)) {
          return;
        }

        const memberName = getMemberName(node);
        if (!memberName) {
          return;
        }

        if (BANNED_PAGE_METHODS.has(memberName)) {
          context.report({ node, messageId: "pageAccess" });
          return;
        }

        if (isAllowedPageCall(node, ALLOWED_PAGE_METHODS)) {
          return;
        }

        context.report({ node, messageId: "pageAccess" });
      },
    };
  },
};
