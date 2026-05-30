import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InboundSharesCards } from "../../../components/sharing/InboundSharesCards";
import * as contextModule from "../../../lib/context";
import type { SharingPageData } from "../../../features/sharing/types";

const pushMock = vi.fn<(href: string) => void>();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildInbound(overrides?: Partial<SharingPageData["inbound"]>): SharingPageData["inbound"] {
  return {
    active: [
      {
        id: "inbound-1",
        status: "active",
        ownerUserId: "owner-42",
        ownerEmail: "owner@example.com",
        ownerDisplayName: "Owner Example",
        createdAt: "2026-04-10T00:00:00.000Z",
        revokedAt: null,
      },
    ],
    revoked: [],
    ...overrides,
  };
}

describe("InboundSharesCards open-dashboard button", () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    pushMock.mockReset();
    writeSpy = vi.spyOn(contextModule, "writeContextCookie").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    writeSpy.mockRestore();
  });

  it("renders a button (not an anchor) with the preserved data-testid", () => {
    // Arrange
    const inbound = buildInbound();

    // Act
    act(() => {
      root.render(<InboundSharesCards locale="en" inbound={inbound} />);
    });

    // Assert
    const el = document.querySelector("[data-testid='sharing-open-dashboard-inbound-1']");
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("BUTTON");
  });

  it("writes the context cookie with ownerUserId then routes to /dashboard on click", () => {
    // Arrange
    const inbound = buildInbound();
    act(() => {
      root.render(<InboundSharesCards locale="en" inbound={inbound} />);
    });
    const button = document.querySelector(
      "[data-testid='sharing-open-dashboard-inbound-1']",
    ) as HTMLButtonElement;

    // Act
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Assert
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("owner-42");
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
    // Cookie write must happen before the route push.
    expect(writeSpy.mock.invocationCallOrder[0]).toBeLessThan(pushMock.mock.invocationCallOrder[0]);
  });

  it("does not write the context cookie when ownerUserId is null, but still navigates", () => {
    // Arrange — grants from legacy rows may lack ownerUserId.
    const inbound = buildInbound({
      active: [
        {
          id: "inbound-null",
          status: "active",
          ownerUserId: null,
          ownerEmail: "legacy@example.com",
          ownerDisplayName: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          revokedAt: null,
        },
      ],
      revoked: [],
    });
    act(() => {
      root.render(<InboundSharesCards locale="en" inbound={inbound} />);
    });
    const button = document.querySelector(
      "[data-testid='sharing-open-dashboard-inbound-null']",
    ) as HTMLButtonElement;

    // Act
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Assert
    expect(writeSpy).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });
});
