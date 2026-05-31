import { describe, expect, it } from "vitest";
import {
  buildShareGrantedNotification,
  buildShareRevokedNotification,
} from "../../src/persistence/shareHelpers.js";
import { shareNotificationStrings } from "../../src/persistence/shareNotificationStrings.js";

const SHARE_ID = "share-abc-123";
const OWNER_ID = "owner-user-1";
const GRANTEE_ID = "grantee-user-2";

const namedOwner = {
  id: OWNER_ID,
  email: "owner@example.com",
  displayName: "Alice Owner",
};

const anonOwner = {
  id: OWNER_ID,
  email: null as null,
  displayName: null as null,
};

function expectedBody(template: string, label: string): string {
  return template.replace("{ownerLabel}", label);
}

describe("buildShareGrantedNotification", () => {
  it('en locale — title, body interpolated, detail.kind === "share_granted"', () => {
    const strings = shareNotificationStrings.en;
    const result = buildShareGrantedNotification(SHARE_ID, namedOwner, GRANTEE_ID, "en");

    expect(result.userId).toBe(GRANTEE_ID);
    expect(result.severity).toBe("info");
    expect(result.source).toBe("sharing");
    expect(result.sourceRef).toBe(SHARE_ID);
    expect(result.title).toBe(strings.shareGranted.title);
    expect(result.body).toBe(expectedBody(strings.shareGranted.body, namedOwner.displayName));
    expect(result.detail.kind).toBe("share_granted");
    expect(result.detail.shareId).toBe(SHARE_ID);
    expect(result.detail.ownerUserId).toBe(OWNER_ID);
  });

  it('zh-TW locale — title, body interpolated, detail.kind === "share_granted"', () => {
    const strings = shareNotificationStrings["zh-TW"];
    const result = buildShareGrantedNotification(SHARE_ID, namedOwner, GRANTEE_ID, "zh-TW");

    expect(result.title).toBe(strings.shareGranted.title);
    expect(result.body).toBe(expectedBody(strings.shareGranted.body, namedOwner.displayName));
    expect(result.detail.kind).toBe("share_granted");
  });

  it("en — displayName=null, email=null → anonymousOwnerFallback in body", () => {
    const strings = shareNotificationStrings.en;
    const result = buildShareGrantedNotification(SHARE_ID, anonOwner, GRANTEE_ID, "en");

    expect(result.body).toBe(expectedBody(strings.shareGranted.body, strings.anonymousOwnerFallback));
    expect(result.detail.kind).toBe("share_granted");
  });

  it("zh-TW — displayName=null, email=null → zh-TW anonymousOwnerFallback in body", () => {
    const strings = shareNotificationStrings["zh-TW"];
    const result = buildShareGrantedNotification(SHARE_ID, anonOwner, GRANTEE_ID, "zh-TW");

    expect(result.title).toBe(strings.shareGranted.title);
    expect(result.body).toBe(expectedBody(strings.shareGranted.body, strings.anonymousOwnerFallback));
    expect(result.detail.kind).toBe("share_granted");
  });
});

describe("owner-label interpolation preserves literal `$` sequences", () => {
  // String.prototype.replace treats `$&`, `$$`, `$1`, etc. as replacement tokens
  // when the replacement argument is a string. Owner labels (display names and
  // emails) are user-supplied and may contain `$`; the rendered body must keep
  // the label verbatim.
  const dollarOwner = {
    id: OWNER_ID,
    email: "ops$team@example.com",
    displayName: "Cash $$ Money",
  };

  it("en grant body preserves `$$` in displayName", () => {
    const strings = shareNotificationStrings.en;
    const result = buildShareGrantedNotification(SHARE_ID, dollarOwner, GRANTEE_ID, "en");
    expect(result.body).toContain("Cash $$ Money");
    expect(result.body).toBe(
      strings.shareGranted.body.split("{ownerLabel}").join(dollarOwner.displayName),
    );
  });

  it("en revoke body preserves `$` in email when displayName is null", () => {
    const strings = shareNotificationStrings.en;
    const emailOnly = { id: OWNER_ID, email: "ops$team@example.com", displayName: null };
    const result = buildShareRevokedNotification(SHARE_ID, emailOnly, GRANTEE_ID, "en");
    expect(result.body).toContain("ops$team@example.com");
    expect(result.body).toBe(
      strings.shareRevoked.body.split("{ownerLabel}").join(emailOnly.email),
    );
  });

  it("zh-TW grant body preserves `$&` sequence in displayName", () => {
    const strings = shareNotificationStrings["zh-TW"];
    const ampOwner = { id: OWNER_ID, email: null, displayName: "A $& B" };
    const result = buildShareGrantedNotification(SHARE_ID, ampOwner, GRANTEE_ID, "zh-TW");
    expect(result.body).toContain("A $& B");
    expect(result.body).toBe(
      strings.shareGranted.body.split("{ownerLabel}").join(ampOwner.displayName),
    );
  });
});

describe("buildShareRevokedNotification", () => {
  it('en locale — title, body interpolated, detail.kind === "share_revoked"', () => {
    const strings = shareNotificationStrings.en;
    const result = buildShareRevokedNotification(SHARE_ID, namedOwner, GRANTEE_ID, "en");

    expect(result.userId).toBe(GRANTEE_ID);
    expect(result.severity).toBe("info");
    expect(result.source).toBe("sharing");
    expect(result.sourceRef).toBe(SHARE_ID);
    expect(result.title).toBe(strings.shareRevoked.title);
    expect(result.body).toBe(expectedBody(strings.shareRevoked.body, namedOwner.displayName));
    expect(result.detail.kind).toBe("share_revoked");
    expect(result.detail.shareId).toBe(SHARE_ID);
    expect(result.detail.ownerUserId).toBe(OWNER_ID);
  });

  it('zh-TW locale — title, body interpolated, detail.kind === "share_revoked"', () => {
    const strings = shareNotificationStrings["zh-TW"];
    const result = buildShareRevokedNotification(SHARE_ID, namedOwner, GRANTEE_ID, "zh-TW");

    expect(result.title).toBe(strings.shareRevoked.title);
    expect(result.body).toBe(expectedBody(strings.shareRevoked.body, namedOwner.displayName));
    expect(result.detail.kind).toBe("share_revoked");
  });

  it("en — displayName=null, email=null → anonymousOwnerFallback in body", () => {
    const strings = shareNotificationStrings.en;
    const result = buildShareRevokedNotification(SHARE_ID, anonOwner, GRANTEE_ID, "en");

    expect(result.body).toBe(expectedBody(strings.shareRevoked.body, strings.anonymousOwnerFallback));
    expect(result.detail.kind).toBe("share_revoked");
  });

  it("zh-TW — displayName=null, email=null → zh-TW anonymousOwnerFallback in body", () => {
    const strings = shareNotificationStrings["zh-TW"];
    const result = buildShareRevokedNotification(SHARE_ID, anonOwner, GRANTEE_ID, "zh-TW");

    expect(result.title).toBe(strings.shareRevoked.title);
    expect(result.body).toBe(expectedBody(strings.shareRevoked.body, strings.anonymousOwnerFallback));
    expect(result.detail.kind).toBe("share_revoked");
  });
});
