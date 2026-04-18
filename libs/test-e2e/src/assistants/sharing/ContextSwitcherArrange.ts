import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { ContextSwitcherPage } from "../../pages/sharing/ContextSwitcherPage.js";

/** Empty — required by createAssistantFactory's AAA triple. */
export class ContextSwitcherArrange extends BaseArrange {
  declare protected readonly _instance: ContextSwitcherPage;
}
