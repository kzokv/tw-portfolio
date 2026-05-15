import { noElementLocatorChain } from "./rules/no-element-locator-chain.js";
import { noPageAccess } from "./rules/no-page-access.js";
import { noRawAction } from "./rules/no-raw-action.js";

export default {
  meta: {
    name: "@vakwen/eslint-plugin-aaa",
    version: "0.1.0",
  },
  rules: {
    "no-element-locator-chain": noElementLocatorChain,
    "no-page-access": noPageAccess,
    "no-raw-action": noRawAction,
  },
};
