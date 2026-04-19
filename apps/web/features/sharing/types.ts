import type { LocaleCode } from "@tw-portfolio/shared-types";
import type { ProfileWithImpersonationDto } from "../profile/hooks/useProfile";

export type ShareListStatus = "active" | "pending" | "expired" | "revoked";

export interface SharingRouteContextValue {
  isDemo: boolean;
  locale: LocaleCode;
  profile: ProfileWithImpersonationDto;
}

export interface OutboundShareRow {
  id: string;
  shareId: string | null;
  inviteCode: string | null;
  inviteUrl: string | null;
  status: ShareListStatus;
  email: string;
  displayName: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface InboundShareCardItem {
  id: string;
  status: "active" | "revoked";
  ownerUserId: string | null;
  ownerEmail: string;
  ownerDisplayName: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface SharingPageData {
  outbound: Record<ShareListStatus, OutboundShareRow[]>;
  inbound: {
    active: InboundShareCardItem[];
    revoked: InboundShareCardItem[];
  };
}

export type GrantShareResult =
  | {
    type: "resolved";
    email: string;
  }
  | {
    type: "pending";
    email: string;
    inviteCode: string | null;
    inviteUrl: string | null;
    expiresAt: string | null;
  };
