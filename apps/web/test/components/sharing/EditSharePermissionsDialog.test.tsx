import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditSharePermissionsDialog } from "../../../components/sharing/EditSharePermissionsDialog";
import type { OutboundShareRow } from "../../../features/sharing/types";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildRow(overrides: Partial<OutboundShareRow> = {}): OutboundShareRow {
  return {
    id: "share-row-1",
    shareId: "share-1",
    inviteCode: null,
    inviteUrl: null,
    status: "active",
    email: "delegate@example.com",
    displayName: "Delegate",
    createdAt: "2026-04-10T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    capabilities: ["portfolio:mcp_read"],
    ...overrides,
  };
}

describe("EditSharePermissionsDialog", () => {
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

  it("initializes from row capabilities and saves the edited capability set", () => {
    const row = buildRow();
    const onSave = vi.fn();

    act(() => {
      root.render(
        <EditSharePermissionsDialog
          open
          locale="en"
          row={row}
          isSubmitting={false}
          error={null}
          onOpenChange={vi.fn()}
          onSave={onSave}
        />,
      );
    });

    const accountManage = document.querySelector(
      "[data-testid='edit-share-capability-account:manage']",
    ) as HTMLButtonElement;
    expect(accountManage).not.toBeNull();

    act(() => {
      accountManage.click();
    });
    const save = document.querySelector("[data-testid='edit-share-permissions-save']") as HTMLButtonElement;
    act(() => {
      save.click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(row, ["portfolio:mcp_read", "account:manage"]);
  });
});
