import { apiAssistantRegistry } from "@tw-portfolio/test-framework/config";
import { accountsApiAssistantFactory } from "../assistants/accounts/index.js";
import { feeProfilesApiAssistantFactory } from "../assistants/feeProfiles/index.js";
import { notificationsApiAssistantFactory } from "../assistants/notifications/index.js";
import { profileApiAssistantFactory } from "../assistants/profile/index.js";
import { quotesApiAssistantFactory } from "../assistants/quotes/index.js";
import { sessionApiAssistantFactory } from "../assistants/session/index.js";
import { settingsApiAssistantFactory } from "../assistants/settings/index.js";
import { transactionsApiAssistantFactory } from "../assistants/transactions/index.js";
import { AccountsEndpoint } from "../endpoints/AccountsEndpoint.js";
import { FeeProfilesEndpoint } from "../endpoints/FeeProfilesEndpoint.js";
import { NotificationsEndpoint } from "../endpoints/NotificationsEndpoint.js";
import { ProfileEndpoint } from "../endpoints/ProfileEndpoint.js";
import { QuotesEndpoint } from "../endpoints/QuotesEndpoint.js";
import { SessionEndpoint } from "../endpoints/SessionEndpoint.js";
import { SettingsEndpoint } from "../endpoints/SettingsEndpoint.js";
import { TransactionsEndpoint } from "../endpoints/TransactionsEndpoint.js";

let registered = false;

export function registerTestApiAssistants(): void {
  if (registered) {
    return;
  }

  apiAssistantRegistry.register(AccountsEndpoint, accountsApiAssistantFactory);
  apiAssistantRegistry.register(FeeProfilesEndpoint, feeProfilesApiAssistantFactory);
  apiAssistantRegistry.register(NotificationsEndpoint, notificationsApiAssistantFactory);
  apiAssistantRegistry.register(ProfileEndpoint, profileApiAssistantFactory);
  apiAssistantRegistry.register(QuotesEndpoint, quotesApiAssistantFactory);
  apiAssistantRegistry.register(SessionEndpoint, sessionApiAssistantFactory);
  apiAssistantRegistry.register(SettingsEndpoint, settingsApiAssistantFactory);
  apiAssistantRegistry.register(TransactionsEndpoint, transactionsApiAssistantFactory);
  registered = true;
}
