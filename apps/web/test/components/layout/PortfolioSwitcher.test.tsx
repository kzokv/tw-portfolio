import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PortfolioSwitcher } from "../../../components/layout/PortfolioSwitcher";
import { getDictionary } from "../../../lib/i18n";
import type { InboundShareCardItem } from "../../../features/sharing/types";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en").switcher;

function buildInbound(overrides: Partial<InboundShareCardItem>): InboundShareCardItem {
  return {
    id: overrides.id ?? "inbound-1",
    status: "active",
    ownerUserId: overrides.ownerUserId ?? "owner-42",
    ownerEmail: overrides.ownerEmail ?? "owner@example.com",
    ownerDisplayName: overrides.ownerDisplayName ?? "Owner Example",
    createdAt: overrides.createdAt ?? "2026-04-10T00:00:00.000Z",
    revokedAt: null,
    capabilities: overrides.capabilities ?? [],
  };
}

describe("PortfolioSwitcher", () => {
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

  it("renders nothing when there are no inbound active shares", () => {
    // Arrange
    const onSelect = vi.fn();

    // Act
    act(() => {
      root.render(
        <PortfolioSwitcher
          inboundActive={[]}
          currentContextOwnerId={null}
          onSelect={onSelect}
          dict={dict}
        />,
      );
    });

    // Assert
    expect(document.querySelector("[data-testid='portfolio-switcher']")).toBeNull();
    expect(document.querySelector("[data-testid='portfolio-switcher-wrapper']")).toBeNull();
  });

  it("renders the trigger pill when inbound shares exist and user is in own context", () => {
    // Arrange
    const onSelect = vi.fn();
    const inbound = [buildInbound({})];

    // Act
    act(() => {
      root.render(
        <PortfolioSwitcher
          inboundActive={inbound}
          currentContextOwnerId={null}
          onSelect={onSelect}
          dict={dict}
        />,
      );
    });

    // Assert
    const trigger = document.querySelector("[data-testid='portfolio-switcher']");
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain(dict.self);
    // No eyebrow or read-only badge when in own context.
    expect(document.querySelector("[data-testid='portfolio-switcher-eyebrow']")).toBeNull();
    expect(document.querySelector("[data-testid='portfolio-switcher-badge-readonly']")).toBeNull();
  });

  it("renders eyebrow and Read-only badge in the trigger when viewing a shared context", () => {
    // Arrange
    const onSelect = vi.fn();
    const inbound = [buildInbound({ ownerUserId: "owner-42", ownerDisplayName: "Alice" })];

    // Act
    act(() => {
      root.render(
        <PortfolioSwitcher
          inboundActive={inbound}
          currentContextOwnerId="owner-42"
          onSelect={onSelect}
          dict={dict}
        />,
      );
    });

    // Assert
    expect(document.querySelector("[data-testid='portfolio-switcher-eyebrow']")?.textContent).toBe(
      dict.eyebrow,
    );
    expect(
      document.querySelector("[data-testid='portfolio-switcher-badge-readonly']")?.textContent,
    ).toBe(dict.readonlyBadge);
    expect(document.querySelector("[data-testid='portfolio-switcher']")?.textContent).toContain(
      "Alice",
    );
  });

  it("dropdown lists self option, owner options sorted newest-first, and Manage sharing footer", () => {
    // Arrange
    const onSelect = vi.fn();
    const older = buildInbound({
      id: "inbound-older",
      ownerUserId: "owner-older",
      ownerDisplayName: "Older",
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    const newer = buildInbound({
      id: "inbound-newer",
      ownerUserId: "owner-newer",
      ownerDisplayName: "Newer",
      createdAt: "2026-04-15T00:00:00.000Z",
    });

    // Act — defaultOpen forces Radix to portal the content into DOM.
    act(() => {
      root.render(
        <PortfolioSwitcher
          inboundActive={[older, newer]}
          currentContextOwnerId={null}
          onSelect={onSelect}
          dict={dict}
          defaultOpen
        />,
      );
    });

    // Assert — all three testids present: self, both owners by ownerUserId, Manage sharing.
    expect(document.querySelector("[data-testid='portfolio-switcher-dropdown']")).not.toBeNull();
    expect(document.querySelector("[data-testid='portfolio-switcher-option-self']")).not.toBeNull();
    // Enumerate owner options by specific testid (not prefix-matching), so the
    // assertion doesn't accidentally skip owner options whose userId happens
    // not to start with "owner-" (real production userIds are UUIDs).
    const newerOwner = document.querySelector(
      "[data-testid='portfolio-switcher-option-owner-newer']",
    );
    const olderOwner = document.querySelector(
      "[data-testid='portfolio-switcher-option-owner-older']",
    );
    expect(newerOwner).not.toBeNull();
    expect(olderOwner).not.toBeNull();
    // Sort order: newer first. Compare DOM document order — the first matching
    // element of newer vs. older should appear earlier in the dropdown.
    const dropdown = document.querySelector("[data-testid='portfolio-switcher-dropdown']")!;
    const position = newerOwner!.compareDocumentPosition(olderOwner!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dropdown.contains(newerOwner!)).toBe(true);
    expect(dropdown.contains(olderOwner!)).toBe(true);
    expect(
      document.querySelector("[data-testid='portfolio-switcher-manage-sharing']"),
    ).not.toBeNull();
  });

  it("calls onSelect(null) when the self option is chosen", () => {
    // Arrange
    const onSelect = vi.fn();
    const inbound = [buildInbound({ ownerUserId: "owner-42" })];
    act(() => {
      root.render(
        <PortfolioSwitcher
          inboundActive={inbound}
          currentContextOwnerId="owner-42"
          onSelect={onSelect}
          dict={dict}
          defaultOpen
        />,
      );
    });

    // Act
    const selfItem = document.querySelector(
      "[data-testid='portfolio-switcher-option-self']",
    ) as HTMLElement;
    act(() => {
      selfItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Assert
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onSelect(ownerUserId) when an owner option is chosen", () => {
    // Arrange
    const onSelect = vi.fn();
    const inbound = [buildInbound({ ownerUserId: "owner-42" })];
    act(() => {
      root.render(
        <PortfolioSwitcher
          inboundActive={inbound}
          currentContextOwnerId={null}
          onSelect={onSelect}
          dict={dict}
          defaultOpen
        />,
      );
    });

    // Act
    const ownerItem = document.querySelector(
      "[data-testid='portfolio-switcher-option-owner-42']",
    ) as HTMLElement;
    act(() => {
      ownerItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Assert
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("owner-42");
  });
});
