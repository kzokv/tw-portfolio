import type { APIResponse } from "@playwright/test";
import type { AdminAuditLogEntryDto } from "@vakwen/shared-types";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { AnonymousShareTokensEndpoint } from "../../endpoints/AnonymousShareTokensEndpoint.js";
import type {
  TAnonymousShareTokenDto,
  TAnonymousShareTokensListBody,
  TPublicShareViewBody,
} from "./AnonymousShareTokensApiArrange.js";

export class AnonymousShareTokensApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: AnonymousShareTokensEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async errorCodeIs(responseBody: { error: string }, expected: string): Promise<void> {
    await this.mxAssertEqual(responseBody.error, expected, "error code");
  }

  @Step()
  async tokenShapeIsValid(token: TAnonymousShareTokenDto): Promise<void> {
    await this.mxAssertTruthy(typeof token.id === "string" && token.id.length > 0, "token.id non-empty");
    await this.mxAssertTruthy(
      typeof token.token === "string" && token.token.length === 22,
      "token.token is 22-char base62",
    );
    await this.mxAssertTruthy(typeof token.url === "string" && token.url.length > 0, "token.url non-empty");
    await this.mxAssertTruthy(typeof token.createdAt === "string", "token.createdAt is string");
    await this.mxAssertTruthy(typeof token.expiresAt === "string", "token.expiresAt is string");
    await this.mxAssertTruthy(
      ["active", "expired", "revoked"].includes(token.status),
      `token.status is valid (got ${token.status})`,
    );
  }

  @Step()
  async tokenStatusIs(
    token: TAnonymousShareTokenDto,
    expected: "active" | "expired" | "revoked",
  ): Promise<void> {
    await this.mxAssertEqual(token.status, expected, "token.status");
  }

  @Step()
  async listLengthIs(body: TAnonymousShareTokensListBody, expected: number): Promise<void> {
    await this.mxAssertEqual(body.tokens.length, expected, "tokens.length");
  }

  @Step()
  async listContainsTokenId(body: TAnonymousShareTokensListBody, tokenId: string): Promise<void> {
    await this.mxAssertTruthy(
      body.tokens.some((t) => t.id === tokenId),
      `list contains tokenId ${tokenId}`,
    );
  }

  @Step()
  async listExcludesTokenId(body: TAnonymousShareTokensListBody, tokenId: string): Promise<void> {
    await this.mxAssertTruthy(
      !body.tokens.some((t) => t.id === tokenId),
      `list excludes tokenId ${tokenId}`,
    );
  }

  @Step()
  async publicViewShapeIsValid(body: TPublicShareViewBody): Promise<void> {
    await this.mxAssertTruthy(
      typeof body.ownerDisplayName === "string" && body.ownerDisplayName.length > 0,
      "ownerDisplayName non-empty",
    );
    await this.mxAssertTruthy(typeof body.expiresAt === "string", "expiresAt is string");
    await this.mxAssertTruthy(Array.isArray(body.holdings), "holdings is array");
    await this.mxAssertTruthy(
      body.summary !== null && typeof body.summary === "object",
      "summary is object",
    );
    await this.mxAssertTruthy(
      Array.isArray(body.summary.totalValueByCurrency),
      "summary.totalValueByCurrency is array",
    );
    await this.mxAssertTruthy(
      Array.isArray(body.summary.returnByCurrency),
      "summary.returnByCurrency is array",
    );
  }

  @Step()
  async publicViewExcludesForbiddenFields(body: TPublicShareViewBody): Promise<void> {
    const serialized = JSON.stringify(body);
    for (const forbidden of ["costBasisAmount", "transactions", "dividends", "txnHistory"]) {
      await this.mxAssertTruthy(!serialized.includes(forbidden), `public view omits ${forbidden}`);
    }
  }

  @Step()
  async publicViewSortedByMarketValueDesc(body: TPublicShareViewBody): Promise<void> {
    for (let index = 1; index < body.holdings.length; index += 1) {
      await this.mxAssertTruthy(
        body.holdings[index - 1]!.marketValueAmount >= body.holdings[index]!.marketValueAmount,
        `holdings sorted descending at index ${index}`,
      );
    }
  }

  @Step()
  async publicViewHasNoZeroQuantityRows(body: TPublicShareViewBody): Promise<void> {
    await this.mxAssertTruthy(
      body.holdings.every((holding) => holding.quantity > 0),
      "public view filters zero-quantity holdings",
    );
  }

  @Step()
  async headerEquals(response: APIResponse, headerName: string, expected: string): Promise<void> {
    await this.mxAssertEqual(
      response.headers()[headerName.toLowerCase()],
      expected,
      `header ${headerName.toLowerCase()}`,
    );
  }

  @Step()
  async publicViewHoldingCount(body: TPublicShareViewBody, expected: number): Promise<void> {
    await this.mxAssertEqual(body.holdings.length, expected, "holdings.length");
  }

  @Step()
  async publicViewContainsTicker(body: TPublicShareViewBody, ticker: string): Promise<void> {
    await this.mxAssertTruthy(
      body.holdings.some((h) => h.ticker === ticker),
      `holdings contain ${ticker}`,
    );
  }

  @Step()
  async auditEntryMatchesMetadata(
    entry: AdminAuditLogEntryDto,
    expected: Record<string, unknown>,
  ): Promise<void> {
    for (const [key, value] of Object.entries(expected)) {
      await this.mxAssertEqual(entry.metadata[key], value, `audit.metadata.${key}`);
    }
  }

  @Step()
  async auditEntryOmitsMetadata(entry: AdminAuditLogEntryDto, forbiddenKey: string): Promise<void> {
    await this.mxAssertTruthy(
      !(forbiddenKey in entry.metadata),
      `audit metadata omits ${forbiddenKey}`,
    );
  }
}
