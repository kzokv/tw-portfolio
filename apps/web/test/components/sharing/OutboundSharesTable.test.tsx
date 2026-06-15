import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OutboundSharesTable } from "../../../components/sharing/OutboundSharesTable";
import type { OutboundShareRow, SharingPageData } from "../../../features/sharing/types";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildRow(overrides: Partial<OutboundShareRow>): OutboundShareRow {
  return {
    id: overrides.id ?? "share-row",
    shareId: overrides.shareId ?? "share-1",
    inviteCode: overrides.inviteCode ?? null,
    inviteUrl: overrides.inviteUrl ?? null,
    status: overrides.status ?? "active",
    email: overrides.email ?? "delegate@example.com",
    displayName: overrides.displayName ?? "Delegate",
    createdAt: overrides.createdAt ?? "2026-04-10T00:00:00.000Z",
    expiresAt: overrides.expiresAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    capabilities: overrides.capabilities ?? [],
  };
}

function buildOutbound(): SharingPageData["outbound"] {
  return {
    active: [buildRow({ id: "active-row", status: "active" })],
    pending: [buildRow({ id: "pending-row", status: "pending", shareId: null, inviteCode: "INVITE1" })],
    expired: [buildRow({ id: "expired-row", status: "expired", shareId: null, inviteCode: "INVITE2" })],
    revoked: [],
  };
}

describe("OutboundSharesTable", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows edit permissions for active and pending rows only", () => {
    const onEditPermissions = vi.fn();
    act(() => {
      root.render(
        <OutboundSharesTable
          locale="en"
          outbound={buildOutbound()}
          showHistory={false}
          onToggleHistory={vi.fn()}
          onCopyUrl={vi.fn()}
          onEditPermissions={onEditPermissions}
          onRevoke={vi.fn()}
          onReshare={vi.fn()}
        />,
      );
    });

    const active = document.querySelector("[data-testid='sharing-edit-permissions-active-row']") as HTMLButtonElement;
    const pending = document.querySelector("[data-testid='sharing-edit-permissions-pending-row']") as HTMLButtonElement;
    expect(active).not.toBeNull();
    expect(pending).not.toBeNull();
    expect(document.querySelector("[data-testid='sharing-edit-permissions-expired-row']")).toBeNull();

    act(() => {
      pending.click();
    });
    expect(onEditPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: "pending-row", inviteCode: "INVITE1" }));
  });
});
