import { createApiFixture } from "@tw-portfolio/test-api/config";
import type {
  TAccountsApiAssistant,
  TDividendsApiAssistant,
  TFeeProfilesApiAssistant,
  TNotificationsApiAssistant,
  TProfileApiAssistant,
  TQuotesApiAssistant,
  TSessionApiAssistant,
  TSettingsApiAssistant,
  TTransactionsApiAssistant,
} from "@tw-portfolio/test-api/assistants";
import { createApiSessionTest } from "@tw-portfolio/test-api/fixtures/sessionBase";
import {
  AccountsEndpoint,
  DividendsEndpoint,
  FeeProfilesEndpoint,
  NotificationsEndpoint,
  ProfileEndpoint,
  QuotesEndpoint,
  SessionEndpoint,
  SettingsEndpoint,
  TransactionsEndpoint,
} from "@tw-portfolio/test-api/endpoints";

const base = createApiSessionTest("oauth");

export const test = base.extend<{
  accountsApi: TAccountsApiAssistant;
  dividendsApi: TDividendsApiAssistant;
  feeProfilesApi: TFeeProfilesApiAssistant;
  notificationsApi: TNotificationsApiAssistant;
  profileApi: TProfileApiAssistant;
  quotesApi: TQuotesApiAssistant;
  sessionApi: TSessionApiAssistant;
  settingsApi: TSettingsApiAssistant;
  transactionsApi: TTransactionsApiAssistant;
}>({
  sessionApi: createApiFixture<TSessionApiAssistant>(SessionEndpoint),
  settingsApi: createApiFixture<TSettingsApiAssistant>(SettingsEndpoint),
  profileApi: createApiFixture<TProfileApiAssistant>(ProfileEndpoint),
  accountsApi: createApiFixture<TAccountsApiAssistant>(AccountsEndpoint),
  dividendsApi: createApiFixture<TDividendsApiAssistant>(DividendsEndpoint),
  feeProfilesApi: createApiFixture<TFeeProfilesApiAssistant>(FeeProfilesEndpoint),
  notificationsApi: createApiFixture<TNotificationsApiAssistant>(NotificationsEndpoint),
  quotesApi: createApiFixture<TQuotesApiAssistant>(QuotesEndpoint),
  transactionsApi: createApiFixture<TTransactionsApiAssistant>(TransactionsEndpoint),
});
