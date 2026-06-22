import type { LocaleCode, ShareCapability } from "@vakwen/shared-types";
import type { ProfileWithImpersonationDto } from "../profile/hooks/useProfile";

export type SharingDataContextScope = "portfolio" | "session";

export type ShareListStatus = "active" | "pending" | "expired" | "revoked";

export interface SharingRouteContextValue {
  isDemo: boolean;
  locale: LocaleCode;
  profile: ProfileWithImpersonationDto;
  /** SSR-resolved sidebar collapsed state (Preserves §8 item 14). */
  initialSidebarOpen: boolean;
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
  capabilities: ShareCapability[];
}

export interface InboundShareCardItem {
  id: string;
  status: "active" | "revoked";
  ownerUserId: string | null;
  ownerEmail: string;
  ownerDisplayName: string | null;
  createdAt: string;
  revokedAt: string | null;
  capabilities: ShareCapability[];
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
    capabilities: ShareCapability[];
  }
  | {
    type: "pending";
    email: string;
    inviteCode: string | null;
    inviteUrl: string | null;
    expiresAt: string | null;
    capabilities: ShareCapability[];
  };
