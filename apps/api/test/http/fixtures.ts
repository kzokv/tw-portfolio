import { createApiFixture } from "@tw-portfolio/test-api/config";
import type {
  TAccountsApiAssistant,
  TFeeProfilesApiAssistant,
  TProfileApiAssistant,
  TSessionApiAssistant,
  TSettingsApiAssistant,
  TTransactionsApiAssistant,
} from "@tw-portfolio/test-api/assistants";
import { createApiSessionTest } from "@tw-portfolio/test-api/fixtures/sessionBase";
import {
  AccountsEndpoint,
  FeeProfilesEndpoint,
  ProfileEndpoint,
  SessionEndpoint,
  SettingsEndpoint,
  TransactionsEndpoint,
} from "@tw-portfolio/test-api/endpoints";

const base = createApiSessionTest("oauth");

export const test = base.extend<{
  accountsApi: TAccountsApiAssistant;
  feeProfilesApi: TFeeProfilesApiAssistant;
  profileApi: TProfileApiAssistant;
  sessionApi: TSessionApiAssistant;
  settingsApi: TSettingsApiAssistant;
  transactionsApi: TTransactionsApiAssistant;
}>({
  sessionApi: createApiFixture<TSessionApiAssistant>(SessionEndpoint),
  settingsApi: createApiFixture<TSettingsApiAssistant>(SettingsEndpoint),
  profileApi: createApiFixture<TProfileApiAssistant>(ProfileEndpoint),
  accountsApi: createApiFixture<TAccountsApiAssistant>(AccountsEndpoint),
  feeProfilesApi: createApiFixture<TFeeProfilesApiAssistant>(FeeProfilesEndpoint),
  transactionsApi: createApiFixture<TTransactionsApiAssistant>(TransactionsEndpoint),
});
