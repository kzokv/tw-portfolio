import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { DividendsEndpoint } from "../../endpoints/DividendsEndpoint.js";

type TObject = Record<string, unknown>;

export class DividendsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: DividendsEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async arrayLengthAtLeast(entries: TObject[], minimum: number, label = "dividend entries"): Promise<void> {
    await this.mxAssertArrayLengthAtLeast(entries, minimum, label);
  }

  @Step()
  async fieldEquals(entry: TObject, field: string, expected: unknown, label = "dividend entry"): Promise<void> {
    await this.mxAssertObjectHasKey(entry, field, label);
    await this.mxAssertEqual(entry[field], expected, `${label}.${field}`);
  }

  @Step()
  async fieldMatches(entry: TObject, field: string, expected: RegExp, label = "dividend entry"): Promise<void> {
    await this.mxAssertObjectHasKey(entry, field, label);
    await this.mxAssertMatches(String(entry[field] ?? ""), expected, `${label}.${field}`);
  }

  @Step()
  async hasErrorCode(body: TObject, expected: string): Promise<void> {
    await this.mxAssertObjectHasKey(body, "error", "error response");
    await this.mxAssertEqual(body.error, expected, "error response.error");
  }

  @Step()
  async nestedCollectionsPresent(entry: TObject): Promise<void> {
    await this.mxAssertObjectHasKey(entry, "deductions", "dividend entry");
    await this.mxAssertObjectHasKey(entry, "sourceLines", "dividend entry");
    await this.mxAssertObjectHasKey(entry, "version", "dividend entry");
  }

  @Step()
  async versionIncremented(before: TObject, after: TObject): Promise<void> {
    await this.mxAssertObjectHasKey(before, "version", "previous dividend entry");
    await this.mxAssertObjectHasKey(after, "version", "updated dividend entry");
    await this.mxAssertEqual(Number(after.version), Number(before.version) + 1, "dividend entry version");
  }

  @Step()
  async sourceLinesReconcileWithinTolerance(entry: TObject): Promise<void> {
    const sourceLines = Array.isArray(entry.sourceLines) ? entry.sourceLines as TObject[] : [];
    const deductions = Array.isArray(entry.deductions) ? entry.deductions as TObject[] : [];
    const totalSourceLines = sourceLines.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const withheldDeductions = deductions
      .filter((item) => item.withheldAtSource === true)
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const grossAmount = Number(entry.receivedCashAmount ?? 0) + withheldDeductions;
    await this.mxAssertEqual(Math.abs(totalSourceLines - grossAmount) <= 1, true, "source line variance within tolerance");
  }
}
