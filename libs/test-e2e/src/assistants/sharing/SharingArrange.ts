import { BaseArrange } from "@vakwen/test-framework/mixins";

import type { SharingPage } from "../../pages/sharing/SharingPage.js";

/** Empty — required by createAssistantFactory's AAA triple. */
export class SharingArrange extends BaseArrange {
  declare protected readonly _instance: SharingPage;
}
