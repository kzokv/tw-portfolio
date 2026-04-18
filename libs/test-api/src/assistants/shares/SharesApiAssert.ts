import type { APIResponse } from "@playwright/test";
import type { AdminAuditLogEntryDto, NotificationDto } from "@tw-portfolio/shared-types";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { SharesEndpoint } from "../../endpoints/SharesEndpoint.js";
import type { TShareCreateBody, TSharesListBody } from "./SharesApiArrange.js";

function rowContainsValue(row: unknown, expected: string): boolean {
  if (typeof row === "string") {
    return row === expected;
  }

  if (Array.isArray(row)) {
    return row.some((item) => rowContainsValue(item, expected));
  }

  if (row && typeof row === "object") {
    return Object.values(row).some((value) => rowContainsValue(value, expected));
  }

  return false;
}

export class SharesApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: SharesEndpoint;

  private resolveBucket(
    body: TSharesListBody,
    section: "outbound" | "inbound",
    bucket: "active" | "pending" | "expired" | "revoked",
  ): Record<string, unknown>[] {
    if (section === "outbound") {
      return body.outbound[bucket];
    }

    if (bucket !== "active" && bucket !== "revoked") {
      throw new Error(`inbound section has no '${bucket}' bucket (only active/revoked)`);
    }
    return body.inbound[bucket];
  }

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async createTypeIs(body: TShareCreateBody, expected: "resolved" | "pending"): Promise<void> {
    await this.mxAssertEqual(body.type, expected, "share create type");
  }

  @Step()
  async bucketContainsValue(
    body: TSharesListBody,
    section: "outbound" | "inbound",
    bucket: "active" | "pending" | "expired" | "revoked",
    expected: string,
  ): Promise<void> {
    const rows = this.resolveBucket(body, section, bucket);
    await this.mxAssertTruthy(
      rows.some((row: Record<string, unknown>) => rowContainsValue(row, expected)),
      `${section}.${bucket} contains ${expected}`,
    );
  }

  @Step()
  async bucketLengthIs(
    body: TSharesListBody,
    section: "outbound" | "inbound",
    bucket: "active" | "pending" | "expired" | "revoked",
    expected: number,
  ): Promise<void> {
    await this.mxAssertEqual(this.resolveBucket(body, section, bucket).length, expected, `${section}.${bucket}.length`);
  }

  @Step()
  async auditEntryMatchesMetadata(entry: AdminAuditLogEntryDto, expected: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(expected)) {
      await this.mxAssertEqual(entry.metadata[key], value, `audit.metadata.${key}`);
    }
  }

  @Step()
  async notificationMatches(
    notification: NotificationDto,
    expected: Partial<Pick<NotificationDto, "source" | "title" | "severity">> & {
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (expected.source !== undefined) {
      await this.mxAssertEqual(notification.source, expected.source, "notification.source");
    }
    if (expected.title !== undefined) {
      await this.mxAssertEqual(notification.title, expected.title, "notification.title");
    }
    if (expected.severity !== undefined) {
      await this.mxAssertEqual(notification.severity, expected.severity, "notification.severity");
    }
    if (expected.detail !== undefined) {
      await this.mxAssertTruthy(
        notification.detail !== null && typeof notification.detail === "object",
        "notification.detail is an object",
      );
      const actualDetail = notification.detail as Record<string, unknown>;
      for (const [key, value] of Object.entries(expected.detail)) {
        await this.mxAssertEqual(actualDetail[key], value, `notification.detail.${key}`);
      }
    }
  }

  @Step()
  async fieldEquals(body: Record<string, unknown>, field: string, expected: unknown): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "share body");
    await this.mxAssertEqual(body[field], expected, `share.${field}`);
  }

  @Step()
  async fieldContains(body: Record<string, unknown>, field: string, expected: string): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "share body");
    await this.mxAssertTruthy(
      typeof body[field] === "string" && body[field].includes(expected),
      `share.${field} contains ${expected}`,
    );
  }
}
