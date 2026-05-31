import { BaseArrange } from "@vakwen/test-framework/mixins";

import type { AnonymousSharePage } from "../../pages/sharing/AnonymousSharePage.js";

/** Empty — required by createAssistantFactory's AAA triple. */
export class AnonymousShareArrange extends BaseArrange {
  declare protected readonly _instance: AnonymousSharePage;
}
