/**
 * Shared helpers for the sharing feature. Used by both memory and postgres
 * persistence backends to keep audit metadata + notification shape in one place.
 *
 * The `ShareUser` type is a minimal structural shape — callers adapt from their
 * native row types (MemoryUser, PG row) at call sites.
 */

import type { LocaleCode } from "@vakwen/shared-types";
import { shareNotificationStrings } from "./shareNotificationStrings.js";

export interface ShareUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export type ShareNotificationKind = "share_granted" | "share_revoked";

export interface ShareNotificationInput {
  userId: string;
  severity: "info";
  source: "sharing";
  sourceRef: string;
  title: string;
  body: string;
  detail: {
    kind: ShareNotificationKind;
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

function resolveStrings(granteeLocale: LocaleCode) {
  return shareNotificationStrings[granteeLocale] ?? shareNotificationStrings.en;
}

function resolveOwnerLabel(owner: ShareUser, anonymousFallback: string): string {
  return owner.displayName || owner.email || anonymousFallback;
}

function interpolateOwnerLabel(template: string, ownerLabel: string): string {
  // Function replacement bypasses $-token interpretation (e.g. "$&", "$$", "$1")
  // that String.prototype.replace applies to string replacements.
  return template.replace("{ownerLabel}", () => ownerLabel);
}

export function buildShareGrantedNotification(
  shareId: string,
  owner: ShareUser,
  granteeUserId: string,
  granteeLocale: LocaleCode,
): ShareNotificationInput {
  const strings = resolveStrings(granteeLocale);
  const ownerLabel = resolveOwnerLabel(owner, strings.anonymousOwnerFallback);
  return {
    userId: granteeUserId,
    severity: "info",
    source: "sharing",
    sourceRef: shareId,
    title: strings.shareGranted.title,
    body: interpolateOwnerLabel(strings.shareGranted.body, ownerLabel),
    detail: {
      kind: "share_granted",
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
  granteeLocale: LocaleCode,
): ShareNotificationInput {
  const strings = resolveStrings(granteeLocale);
  const ownerLabel = resolveOwnerLabel(owner, strings.anonymousOwnerFallback);
  return {
    userId: granteeUserId,
    severity: "info",
    source: "sharing",
    sourceRef: shareId,
    title: strings.shareRevoked.title,
    body: interpolateOwnerLabel(strings.shareRevoked.body, ownerLabel),
    detail: {
      kind: "share_revoked",
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      ownerDisplayName: owner.displayName,
      shareId,
    },
  };
}
