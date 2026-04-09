import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { DividendsEndpoint } from "../../endpoints/DividendsEndpoint.js";

type TObject = Record<string, unknown>;

export class DividendsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: DividendsEndpoint;

  @Step()
  async seedBody(response: APIResponse): Promise<TObject> {
    return (await this.body(response)) as TObject;
  }

  @Step()
  async dividendEvents(response: APIResponse): Promise<TObject[]> {
    const body = (await this.body(response)) as TObject[] | { dividendEvents?: TObject[] };
    if (Array.isArray(body)) {
      return body;
    }
    return body.dividendEvents ?? [];
  }

  @Step()
  async dividendLedgerEntries(response: APIResponse): Promise<TObject[]> {
    const body = (await this.body(response)) as TObject[] | { ledgerEntries?: TObject[] };
    if (Array.isArray(body)) {
      return body;
    }
    return body.ledgerEntries ?? [];
  }

  @Step()
  async postingBody(response: APIResponse): Promise<TObject> {
    return (await this.body(response)) as TObject;
  }

  @Step()
  async dividendLedgerEntry(response: APIResponse): Promise<TObject> {
    const body = await this.postingBody(response);
    const entry = body.dividendLedgerEntry;
    if (!entry || typeof entry !== "object") {
      throw new Error("Expected dividendLedgerEntry in posting response");
    }
    return entry as TObject;
  }

  @Step()
  async firstEntry(entries: TObject[]): Promise<TObject> {
    if (entries.length === 0) {
      throw new Error("Expected at least one dividend entry");
    }
    return entries[0]!;
  }

  @Step()
  async seededDividendEventId(body: TObject): Promise<string> {
    const dividendEvent = body.dividendEvent;
    if (!dividendEvent || typeof dividendEvent !== "object" || !("id" in dividendEvent)) {
      throw new Error("Expected dividendEvent.id in seed response");
    }
    return String((dividendEvent as TObject).id);
  }
}
