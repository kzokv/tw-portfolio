import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { AnonymousShareTokensEndpoint } from "../../endpoints/AnonymousShareTokensEndpoint.js";

export interface TAnonymousShareTokenDto {
  id: string;
  token: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
}

export interface TAnonymousShareTokensListBody {
  tokens: TAnonymousShareTokenDto[];
}

export interface TPublicShareHolding {
  ticker: string;
  quantity: number;
  marketValueAmount: number;
  marketValueCurrency: string;
  allocationPercent: number;
}

export interface TPublicShareSummary {
  totalValueByCurrency: Array<{ currency: string; amount: number }>;
  returnByCurrency: Array<{ currency: string; returnPercent: number }>;
}

export interface TPublicShareViewBody {
  ownerDisplayName: string;
  expiresAt: string;
  holdings: TPublicShareHolding[];
  summary: TPublicShareSummary;
  quoteAsOf: string | null;
}

export interface TAnonymousShareErrorBody {
  error: string;
  message?: string;
}

export class AnonymousShareTokensApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: AnonymousShareTokensEndpoint;

  @Step()
  async createBody(response: APIResponse): Promise<TAnonymousShareTokenDto> {
    return (await this.body(response)) as TAnonymousShareTokenDto;
  }

  @Step()
  async listBody(response: APIResponse): Promise<TAnonymousShareTokensListBody> {
    return (await this.body(response)) as TAnonymousShareTokensListBody;
  }

  @Step()
  async publicViewBody(response: APIResponse): Promise<TPublicShareViewBody> {
    return (await this.body(response)) as TPublicShareViewBody;
  }

  findTokenById(body: TAnonymousShareTokensListBody, tokenId: string): TAnonymousShareTokenDto | undefined {
    return body.tokens.find((token) => token.id === tokenId);
  }

  @Step()
  async errorBody(response: APIResponse): Promise<TAnonymousShareErrorBody> {
    return (await this.body(response)) as TAnonymousShareErrorBody;
  }
}
