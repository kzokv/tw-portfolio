import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnonymousShareTokenDto } from "@tw-portfolio/shared-types";
import { AnonymousLinksTable } from "../../../components/sharing/AnonymousLinksTable";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildToken(overrides: Partial<AnonymousShareTokenDto> = {}): AnonymousShareTokenDto {
  return {
    id: "tok-1",
    token: "aB3cDeFgHiJkLmNoPqR9Xy",
    url: "https://kzokvdevs.example.org/share/aB3cDeFgHiJkLmNoPqR9Xy",
    createdAt: "2026-04-18T10:00:00.000Z",
    expiresAt: "2026-05-18T10:00:00.000Z",
    revokedAt: null,
    status: "active",
    ...overrides,
  };
}

describe("AnonymousLinksTable", () => {
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

  it("renders empty state when no tokens", () => {
    act(() => {
      root.render(
        <AnonymousLinksTable
          locale="en"
          tokens={[]}
          justCreatedId={null}
          copyAffordanceId={null}
          copyFeedbackId={null}
          onCopyUrl={vi.fn()}
          onRevoke={vi.fn()}
        />,
      );
    });

    const empty = document.querySelector("[data-testid='sharing-public-links-empty']");
    expect(empty).not.toBeNull();
    const table = document.querySelector("[data-testid='sharing-public-links-table']");
    expect(table).toBeNull();
  });

  it("truncates token display to first 4 … last 4 characters", () => {
    act(() => {
      root.render(
        <AnonymousLinksTable
          locale="en"
          tokens={[buildToken()]}
          justCreatedId={null}
          copyAffordanceId={null}
          copyFeedbackId={null}
          onCopyUrl={vi.fn()}
          onRevoke={vi.fn()}
        />,
      );
    });

    const tokenEl = document.querySelector("[data-testid='sharing-public-link-token-tok-1']");
    expect(tokenEl).not.toBeNull();
    // Token "aB3cDeFgHiJkLmNoPqR9Xy" → "aB3c…R9Xy"
    expect(tokenEl?.textContent).toContain("aB3c");
    expect(tokenEl?.textContent).toContain("R9Xy");
    expect(tokenEl?.textContent).toContain("…");
    expect(tokenEl?.textContent).not.toContain("DeFgHiJkLmNoPq");
  });

  it("shows Just created badge only for the row matching justCreatedId", () => {
    const tokens = [
      buildToken({ id: "tok-new", token: "qqqqWWWWeeeeRRRRttttYY" }),
      buildToken({ id: "tok-old", token: "aaaaSSSSddddFFFFggggHH" }),
    ];

    act(() => {
      root.render(
        <AnonymousLinksTable
          locale="en"
          tokens={tokens}
          justCreatedId="tok-new"
          copyAffordanceId={null}
          copyFeedbackId={null}
          onCopyUrl={vi.fn()}
          onRevoke={vi.fn()}
        />,
      );
    });

    const badge = document.querySelector("[data-testid='sharing-public-link-new-badge-tok-new']");
    expect(badge).not.toBeNull();
    const otherBadge = document.querySelector("[data-testid='sharing-public-link-new-badge-tok-old']");
    expect(otherBadge).toBeNull();
  });

  it("shows Revoke button for active rows and hides it on terminal rows", () => {
    const tokens = [
      buildToken({ id: "tok-active", status: "active" }),
      buildToken({ id: "tok-revoked", status: "revoked", revokedAt: "2026-04-17T00:00:00.000Z" }),
      buildToken({ id: "tok-expired", status: "expired", expiresAt: "2026-04-01T00:00:00.000Z" }),
    ];

    act(() => {
      root.render(
        <AnonymousLinksTable
          locale="en"
          tokens={tokens}
          justCreatedId={null}
          copyAffordanceId={null}
          copyFeedbackId={null}
          onCopyUrl={vi.fn()}
          onRevoke={vi.fn()}
        />,
      );
    });

    expect(document.querySelector("[data-testid='sharing-public-link-revoke-tok-active']")).not.toBeNull();
    expect(document.querySelector("[data-testid='sharing-public-link-revoke-tok-revoked']")).toBeNull();
    expect(document.querySelector("[data-testid='sharing-public-link-revoke-tok-expired']")).toBeNull();
  });

  it("invokes onCopyUrl with the token when Copy URL is clicked", () => {
    const onCopy = vi.fn();
    const token = buildToken();
    act(() => {
      root.render(
        <AnonymousLinksTable
          locale="en"
          tokens={[token]}
          justCreatedId={null}
          copyAffordanceId={null}
          copyFeedbackId={null}
          onCopyUrl={onCopy}
          onRevoke={vi.fn()}
        />,
      );
    });

    const btn = document.querySelector("[data-testid='sharing-public-link-copy-tok-1']") as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith(token);
  });

  it("invokes onRevoke with the token when Revoke is clicked on an active row", () => {
    const onRevoke = vi.fn();
    const token = buildToken();
    act(() => {
      root.render(
        <AnonymousLinksTable
          locale="en"
          tokens={[token]}
          justCreatedId={null}
          copyAffordanceId={null}
          copyFeedbackId={null}
          onCopyUrl={vi.fn()}
          onRevoke={onRevoke}
        />,
      );
    });

    const btn = document.querySelector("[data-testid='sharing-public-link-revoke-tok-1']") as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(onRevoke).toHaveBeenCalledWith(token);
  });

  it("renders 'Copied' copy-button label when copyFeedbackId matches the row", () => {
    const token = buildToken();
    act(() => {
      root.render(
        <AnonymousLinksTable
          locale="en"
          tokens={[token]}
          justCreatedId={null}
          copyAffordanceId={null}
          copyFeedbackId="tok-1"
          onCopyUrl={vi.fn()}
          onRevoke={vi.fn()}
        />,
      );
    });

    const btn = document.querySelector("[data-testid='sharing-public-link-copy-tok-1']") as HTMLButtonElement;
    expect(btn?.textContent?.toLowerCase()).toContain("copied");
  });
});
