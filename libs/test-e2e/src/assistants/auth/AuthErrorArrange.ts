import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { AuthErrorPage } from "../../pages/auth/AuthErrorPage.js";

/** Empty — required by createAssistantFactory's AAA triple. Add page-specific setup here when needed. */
export class AuthErrorArrange extends BaseArrange {
  declare protected readonly _instance: AuthErrorPage;
}
