import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { AuthErrorPage } from "../../pages/auth/AuthErrorPage.js";

export class AuthErrorArrange extends BaseArrange {
  declare protected readonly _instance: AuthErrorPage;
}
