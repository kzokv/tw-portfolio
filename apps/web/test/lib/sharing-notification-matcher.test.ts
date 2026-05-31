import { describe, expect, it } from "vitest";
import {
  extractSharingNotificationDetail,
  isRevokedSharingNotification,
} from "../../lib/sharing-notification-matcher";

describe("extractSharingNotificationDetail", () => {
  it("returns null for null detail", () => {
    expect(extractSharingNotificationDetail(null)).toBeNull();
  });

  it("returns null for non-object detail", () => {
    expect(extractSharingNotificationDetail("string")).toBeNull();
    expect(extractSharingNotificationDetail(42)).toBeNull();
  });

  it("returns null when kind is missing or unrecognized", () => {
    expect(extractSharingNotificationDetail({})).toBeNull();
    expect(extractSharingNotificationDetail({ kind: "unknown_kind" })).toBeNull();
  });

  it("parses share_granted with full fields", () => {
    const detail = {
      kind: "share_granted",
      ownerUserId: "owner-123",
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      shareId: "share-abc",
    };
    const result = extractSharingNotificationDetail(detail);
    expect(result).toEqual({
      kind: "share_granted",
      ownerUserId: "owner-123",
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
    });
  });

  it("parses share_revoked with full fields", () => {
    const detail = {
      kind: "share_revoked",
      ownerUserId: "owner-456",
      ownerDisplayName: null,
      ownerEmail: "bob@example.com",
    };
    const result = extractSharingNotificationDetail(detail);
    expect(result).toEqual({
      kind: "share_revoked",
      ownerUserId: "owner-456",
      ownerDisplayName: null,
      ownerEmail: "bob@example.com",
    });
  });

  it("returns null for missing optional fields gracefully (treats as null)", () => {
    const result = extractSharingNotificationDetail({ kind: "share_revoked" });
    expect(result).toEqual({
      kind: "share_revoked",
      ownerUserId: null,
      ownerDisplayName: null,
      ownerEmail: null,
    });
  });
});

describe("isRevokedSharingNotification", () => {
  it("returns true for share_revoked kind (en title)", () => {
    expect(
      isRevokedSharingNotification({
        detail: {
          kind: "share_revoked",
          ownerUserId: "owner-1",
          ownerDisplayName: "Alice",
          ownerEmail: "alice@example.com",
          shareId: "share-1",
        },
      }),
    ).toBe(true);
  });

  it("returns true for share_revoked kind with zh-TW title in payload (kind is locale-independent)", () => {
    // The zh-TW title string is irrelevant — matcher uses detail.kind only
    expect(
      isRevokedSharingNotification({
        detail: {
          kind: "share_revoked",
          ownerUserId: "owner-2",
          ownerDisplayName: "王小明",
          ownerEmail: null,
          shareId: "share-2",
        },
      }),
    ).toBe(true);
  });

  it("returns false for share_granted kind", () => {
    expect(
      isRevokedSharingNotification({
        detail: {
          kind: "share_granted",
          ownerUserId: "owner-1",
          ownerDisplayName: "Alice",
          ownerEmail: "alice@example.com",
          shareId: "share-1",
        },
      }),
    ).toBe(false);
  });

  it("returns false when detail.kind is unrelated — even if title matches old string", () => {
    // Pre-Q5 notifications had no detail.kind — matcher must not fire on them
    expect(
      isRevokedSharingNotification({
        detail: {
          ownerUserId: "owner-1",
          shareId: "share-1",
          // no 'kind' field
        },
      }),
    ).toBe(false);
  });

  it("returns false for null detail", () => {
    expect(isRevokedSharingNotification({ detail: null })).toBe(false);
  });

  it("returns false for non-object detail", () => {
    expect(isRevokedSharingNotification({ detail: "Portfolio access revoked" })).toBe(false);
  });

  it("returns false for unknown kind — same title but wrong kind", () => {
    expect(
      isRevokedSharingNotification({
        detail: {
          kind: "daily_refresh",
          ownerUserId: "owner-1",
        },
      }),
    ).toBe(false);
  });
});
