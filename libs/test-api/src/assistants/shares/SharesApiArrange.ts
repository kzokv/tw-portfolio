import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { SharesEndpoint } from "../../endpoints/SharesEndpoint.js";

export interface TSharesListBody {
  outbound: {
    active: Record<string, unknown>[];
    pending: Record<string, unknown>[];
    expired: Record<string, unknown>[];
    revoked: Record<string, unknown>[];
  };
  inbound: {
    active: Record<string, unknown>[];
    revoked: Record<string, unknown>[];
  };
}

export interface TResolvedShareCreateBody {
  type: "resolved";
  share: Record<string, unknown>;
}

export interface TPendingShareCreateBody {
  type: "pending";
  invite: Record<string, unknown>;
}

export type TShareCreateBody = TResolvedShareCreateBody | TPendingShareCreateBody;

export class SharesApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: SharesEndpoint;

  @Step()
  async listBody(response: APIResponse): Promise<TSharesListBody> {
    return (await this.body(response)) as TSharesListBody;
  }

  @Step()
  async createBody(response: APIResponse): Promise<TShareCreateBody> {
    return (await this.body(response)) as TShareCreateBody;
  }

  asResolvedBody(body: TShareCreateBody): TResolvedShareCreateBody {
    if (body.type !== "resolved") {
      throw new Error(`expected resolved create body, got ${body.type}`);
    }
    return body;
  }

  asPendingBody(body: TShareCreateBody): TPendingShareCreateBody {
    if (body.type !== "pending") {
      throw new Error(`expected pending create body, got ${body.type}`);
    }
    return body;
  }
}
