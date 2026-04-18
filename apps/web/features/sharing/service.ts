"use client";

import type {
  CreateShareResponseDto,
  PendingShareInviteDto,
  ShareGrantDto,
  SharesListResponseDto,
} from "@tw-portfolio/shared-types";
import { deleteJson, getJson, postJson } from "../../lib/api";
import type {
  GrantShareResult,
  InboundShareCardItem,
  OutboundShareRow,
  ShareListStatus,
  SharingPageData,
} from "./types";

function toOutboundRowFromShare(dto: ShareGrantDto, status: "active" | "revoked"): OutboundShareRow {
  return {
    id: dto.id,
    shareId: dto.id,
    inviteCode: null,
    inviteUrl: null,
    status,
    email: dto.granteeEmail ?? "",
    displayName: dto.granteeDisplayName,
    createdAt: dto.createdAt,
    expiresAt: null,
    revokedAt: dto.revokedAt,
  };
}

function toOutboundRowFromInvite(dto: PendingShareInviteDto): OutboundShareRow {
  return {
    id: dto.code,
    shareId: null,
    inviteCode: dto.code,
    inviteUrl: dto.inviteUrl,
    status: dto.status,
    email: dto.email,
    displayName: null,
    createdAt: dto.createdAt,
    expiresAt: dto.expiresAt,
    revokedAt: dto.revokedAt,
  };
}

function toInboundCard(dto: ShareGrantDto, status: "active" | "revoked"): InboundShareCardItem {
  return {
    id: dto.id,
    status,
    ownerUserId: dto.ownerUserId,
    ownerEmail: dto.ownerEmail ?? "",
    ownerDisplayName: dto.ownerDisplayName,
    createdAt: dto.createdAt,
    revokedAt: dto.revokedAt,
  };
}

function toOutboundRow(item: ShareGrantDto | PendingShareInviteDto, status: ShareListStatus): OutboundShareRow {
  if ("code" in item) {
    return toOutboundRowFromInvite(item);
  }
  return toOutboundRowFromShare(item, status === "active" ? "active" : "revoked");
}

export function resolveInviteUrl(inviteCode: string | null, inviteUrl: string | null): string | null {
  if (inviteUrl) return inviteUrl;
  if (!inviteCode) return null;

  if (typeof window === "undefined") {
    return `/invite/${inviteCode}`;
  }

  return `${window.location.origin}/invite/${inviteCode}`;
}

export async function fetchSharingPageData(): Promise<SharingPageData> {
  const response = await getJson<SharesListResponseDto>("/shares");

  return {
    outbound: {
      active: response.outbound.active.map((item) => toOutboundRow(item, "active")),
      pending: response.outbound.pending.map((item) => toOutboundRow(item, "pending")),
      expired: response.outbound.expired.map((item) => toOutboundRow(item, "expired")),
      revoked: response.outbound.revoked.map((item) => toOutboundRow(item, "revoked")),
    },
    inbound: {
      active: response.inbound.active.map((item) => toInboundCard(item, "active")),
      revoked: response.inbound.revoked.map((item) => toInboundCard(item, "revoked")),
    },
  };
}

export async function createShareGrant(email: string): Promise<GrantShareResult> {
  const response = await postJson<CreateShareResponseDto>("/shares", { email });

  if (response.type === "pending") {
    return {
      type: "pending",
      email: response.invite.email,
      inviteCode: response.invite.code,
      inviteUrl: response.invite.inviteUrl,
      expiresAt: response.invite.expiresAt,
    };
  }

  return {
    type: "resolved",
    email: response.share.granteeEmail ?? email,
  };
}

export async function revokeActiveShare(shareId: string): Promise<void> {
  await deleteJson(`/shares/${shareId}`);
}

export async function revokePendingShare(inviteCode: string): Promise<void> {
  await deleteJson(`/shares/pending/${inviteCode}`);
}
