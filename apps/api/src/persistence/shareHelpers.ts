/**
 * Shared helpers for the sharing feature. Used by both memory and postgres
 * persistence backends to keep audit metadata + notification shape in one place.
 *
 * The `ShareUser` type is a minimal structural shape — callers adapt from their
 * native row types (MemoryUser, PG row) at call sites.
 */

export interface ShareUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface ShareNotificationInput {
  userId: string;
  severity: "info";
  source: "sharing";
  sourceRef: string;
  title: string;
  body: string;
  detail: {
    ownerUserId: string;
    ownerEmail: string | null;
    ownerDisplayName: string | null;
    shareId: string;
  };
}

export function buildShareAuditMetadata(
  shareId: string,
  owner: Pick<ShareUser, "email" | "displayName">,
  grantee: Pick<ShareUser, "email" | "displayName">,
): Record<string, unknown> {
  return {
    ownerEmail: owner.email,
    ownerDisplayName: owner.displayName,
    granteeEmail: grantee.email,
    granteeDisplayName: grantee.displayName,
    targetEmail: grantee.email,
    targetDisplayName: grantee.displayName,
    shareId,
  };
}

export function buildShareGrantedNotification(
  shareId: string,
  owner: ShareUser,
  granteeUserId: string,
): ShareNotificationInput {
  const ownerLabel = owner.displayName || owner.email || "Someone";
  return {
    userId: granteeUserId,
    severity: "info",
    source: "sharing",
    sourceRef: shareId,
    title: "Portfolio shared with you",
    body: `${ownerLabel} shared their portfolio with you. Open the switcher to view.`,
    detail: {
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      ownerDisplayName: owner.displayName,
      shareId,
    },
  };
}

export function buildShareRevokedNotification(
  shareId: string,
  owner: ShareUser,
  granteeUserId: string,
): ShareNotificationInput {
  const ownerLabel = owner.displayName || owner.email || "Someone";
  return {
    userId: granteeUserId,
    severity: "info",
    source: "sharing",
    sourceRef: shareId,
    title: "Portfolio access revoked",
    body: `${ownerLabel} revoked your access to their portfolio.`,
    detail: {
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      ownerDisplayName: owner.displayName,
      shareId,
    },
  };
}
