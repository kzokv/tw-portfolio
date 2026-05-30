import { getMemberName } from "./ast.js";

// If exemptions become necessary in the future (e.g. allow `.locator()` on a
// specific named receiver), grow the schema to accept
// `{ allowedReceivers: string[] }` and check `node.callee.object` against it
// before reporting. Today the rule is unconditional — the assistants that
// remain in scope do not need exemptions.
export const noElementLocatorChain = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent assistant classes from building locators with raw CSS/xpath chains.",
      url: "https://github.com/anthropics/tw-portfolio/blob/dev/docs/004-notes/automation-refactor/scope-todo-202604251545-aaa-pom-compliance.md",
    },
    messages: {
      locatorChain: "Move locator chains into the page object elements bag.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee?.type !== "MemberExpression") {
          return;
        }

        if (getMemberName(node.callee) !== "locator") {
          return;
        }

        context.report({ node: node.callee, messageId: "locatorChain" });
      },
    };
  },
};
