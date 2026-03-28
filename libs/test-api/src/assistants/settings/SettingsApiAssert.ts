import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { SettingsEndpoint } from "../../endpoints/SettingsEndpoint.js";

export class SettingsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: SettingsEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async fieldEquals(body: Record<string, unknown>, field: string, expected: unknown): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "settings body");
    await this.mxAssertEqual(body[field], expected, `settings.${field}`);
  }

  @Step()
  async bodiesEqual(actual: Record<string, unknown>, expected: Record<string, unknown>): Promise<void> {
    await this.mxAssertDeepEqual(actual, expected, "settings body");
  }

  @Step()
  async errorEquals(body: Record<string, unknown>, expected: string): Promise<void> {
    await this.mxAssertObjectHasKey(body, "error", "error response body");
    await this.mxAssertEqual(body.error, expected, "error response body.error");
  }

  @Step()
  async accountFeeProfileEquals(
    feeConfigBody: Record<string, unknown>,
    accountId: string,
    expectedFeeProfileId: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(feeConfigBody, "accounts", "fee config body");
    const accounts = feeConfigBody.accounts;
    await this.mxAssertArray(accounts, "fee config accounts");
    const matchingAccount = (accounts as Record<string, unknown>[]).find((account) => account.id === accountId);
    await this.mxAssertDefined(matchingAccount, `account ${accountId}`);
    await this.mxAssertEqual(
      matchingAccount?.feeProfileId,
      expectedFeeProfileId,
      `account ${accountId} feeProfileId`,
    );
  }

  @Step()
  async accountFeeProfileDiffers(
    feeConfigBody: Record<string, unknown>,
    accountId: string,
    unexpectedFeeProfileId: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(feeConfigBody, "accounts", "fee config body");
    const accounts = feeConfigBody.accounts;
    await this.mxAssertArray(accounts, "fee config accounts");
    const matchingAccount = (accounts as Record<string, unknown>[]).find((account) => account.id === accountId);
    await this.mxAssertDefined(matchingAccount, `account ${accountId}`);
    await this.mxAssertNotEqual(
      matchingAccount?.feeProfileId,
      unexpectedFeeProfileId,
      `account ${accountId} feeProfileId`,
    );
  }

  @Step()
  async feeProfileExists(feeConfigBody: Record<string, unknown>, feeProfileId: unknown): Promise<void> {
    await this.mxAssertObjectHasKey(feeConfigBody, "feeProfiles", "fee config body");
    const feeProfiles = feeConfigBody.feeProfiles;
    await this.mxAssertArray(feeProfiles, "fee profiles");
    const matchingProfile = (feeProfiles as Record<string, unknown>[]).find((profile) => profile.id === feeProfileId);
    await this.mxAssertDefined(matchingProfile, `fee profile ${String(feeProfileId)}`);
  }

  @Step()
  async feeProfileFieldEquals(
    feeConfigBody: Record<string, unknown>,
    feeProfileId: unknown,
    field: string,
    expected: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(feeConfigBody, "feeProfiles", "fee config body");
    const feeProfiles = feeConfigBody.feeProfiles;
    await this.mxAssertArray(feeProfiles, "fee profiles");
    const matchingProfile = (feeProfiles as Record<string, unknown>[]).find((profile) => profile.id === feeProfileId);
    await this.mxAssertDefined(matchingProfile, `fee profile ${String(feeProfileId)}`);
    await this.mxAssertEqual(
      (matchingProfile as Record<string, unknown>)[field],
      expected,
      `fee profile ${String(feeProfileId)}.${field}`,
    );
  }
}
