import { createApiFixture } from "@tw-portfolio/test-api/config";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "@playwright/test";
import type { TestUser } from "@tw-portfolio/test-framework/core";
import type {
  TAccountsApiAssistant,
  TAdminApiAssistant,
  TAnonymousShareTokensApiAssistant,
  TDividendsApiAssistant,
  TFeeProfilesApiAssistant,
  TFxTransfersApiAssistant,
  TNotificationsApiAssistant,
  TProfileApiAssistant,
  TQuotesApiAssistant,
  TSessionApiAssistant,
  TSharesApiAssistant,
  TSettingsApiAssistant,
  TTransactionsApiAssistant,
} from "@tw-portfolio/test-api/assistants";
import { createApiSessionTest } from "@tw-portfolio/test-api/fixtures/sessionBase";
import {
  AccountsEndpoint,
  AdminEndpoint,
  AnonymousShareTokensEndpoint,
  DividendsEndpoint,
  FeeProfilesEndpoint,
  FxTransfersEndpoint,
  NotificationsEndpoint,
  ProfileEndpoint,
  QuotesEndpoint,
  SessionEndpoint,
  SharesEndpoint,
  SettingsEndpoint,
  TransactionsEndpoint,
} from "@tw-portfolio/test-api/endpoints";

const base = createApiSessionTest("oauth");

type THttpApiFixtures = {
  accountsApi: TAccountsApiAssistant;
  adminApi: TAdminApiAssistant;
  anonymousShareTokensApi: TAnonymousShareTokensApiAssistant;
  dividendsApi: TDividendsApiAssistant;
  feeProfilesApi: TFeeProfilesApiAssistant;
  fxTransfersApi: TFxTransfersApiAssistant;
  notificationsApi: TNotificationsApiAssistant;
  profileApi: TProfileApiAssistant;
  quotesApi: TQuotesApiAssistant;
  sessionApi: TSessionApiAssistant;
  sharesApi: TSharesApiAssistant;
  settingsApi: TSettingsApiAssistant;
  transactionsApi: TTransactionsApiAssistant;
};

type THttpApiBaseFixtures = {
  e2eUserId: string;
  testUser: TestUser;
};

type THttpApiTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & THttpApiBaseFixtures & THttpApiFixtures,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

export const test: THttpApiTest = base.extend<THttpApiFixtures>({
  sessionApi: createApiFixture<TSessionApiAssistant>(SessionEndpoint),
  settingsApi: createApiFixture<TSettingsApiAssistant>(SettingsEndpoint),
  profileApi: createApiFixture<TProfileApiAssistant>(ProfileEndpoint),
  accountsApi: createApiFixture<TAccountsApiAssistant>(AccountsEndpoint),
  adminApi: createApiFixture<TAdminApiAssistant>(AdminEndpoint),
  dividendsApi: createApiFixture<TDividendsApiAssistant>(DividendsEndpoint),
  feeProfilesApi: createApiFixture<TFeeProfilesApiAssistant>(FeeProfilesEndpoint),
  fxTransfersApi: createApiFixture<TFxTransfersApiAssistant>(FxTransfersEndpoint),
  notificationsApi: createApiFixture<TNotificationsApiAssistant>(NotificationsEndpoint),
  quotesApi: createApiFixture<TQuotesApiAssistant>(QuotesEndpoint),
  transactionsApi: createApiFixture<TTransactionsApiAssistant>(TransactionsEndpoint),
  sharesApi: createApiFixture<TSharesApiAssistant>(SharesEndpoint),
  anonymousShareTokensApi: createApiFixture<TAnonymousShareTokensApiAssistant>(
    AnonymousShareTokensEndpoint,
  ),
});
