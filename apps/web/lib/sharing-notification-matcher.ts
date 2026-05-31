export type SharingNotificationKind = "share_granted" | "share_revoked";

export interface SharingNotificationDetail {
  kind: SharingNotificationKind;
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
}

export function extractSharingNotificationDetail(detail: unknown): SharingNotificationDetail | null {
  if (detail === null || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "share_granted" && kind !== "share_revoked") return null;
  const ownerUserId = typeof record.ownerUserId === "string" ? record.ownerUserId : null;
  const ownerDisplayName =
    typeof record.ownerDisplayName === "string" ? record.ownerDisplayName : null;
  const ownerEmail = typeof record.ownerEmail === "string" ? record.ownerEmail : null;
  return { kind, ownerUserId, ownerDisplayName, ownerEmail };
}

export function isRevokedSharingNotification(notification: {
  detail: unknown;
}): boolean {
  const parsed = extractSharingNotificationDetail(notification.detail);
  return parsed?.kind === "share_revoked";
}
