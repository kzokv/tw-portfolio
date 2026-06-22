import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SharedContextStrip } from "../../../components/layout/SharedContextStrip";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function renderStrip(ownerId: string): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SharedContextStrip
        ownerId={ownerId}
        ownerLabel="Owner One"
        titleTemplate="You are viewing {owner}'s portfolio"
        subtitleTemplate="Changes apply to {owner}'s portfolio"
        actionLabel="Back to mine"
        onExitSharedContext={vi.fn()}
      />,
    );
  });

  return { container, root };
}

describe("SharedContextStrip", () => {
  let mounted: Array<{ container: HTMLDivElement; root: Root }>;

  beforeEach(() => {
    mounted = [];
    window.sessionStorage.clear();
  });

  afterEach(() => {
    for (const handle of mounted) {
      act(() => handle.root.unmount());
      handle.container.remove();
    }
    window.sessionStorage.clear();
  });

  it("animates only the first mount for a shared owner in the current browser session", () => {
    const first = renderStrip("owner-1");
    mounted.push(first);
    expect(first.container.querySelector("[data-testid='shared-context-strip']")?.className).toContain("animate-in");

    act(() => first.root.unmount());
    first.container.remove();
    mounted = [];

    const second = renderStrip("owner-1");
    mounted.push(second);
    expect(second.container.querySelector("[data-testid='shared-context-strip']")?.className).not.toContain("animate-in");

    const third = renderStrip("owner-2");
    mounted.push(third);
    expect(third.container.querySelector("[data-testid='shared-context-strip']")?.className).toContain("animate-in");
  });
});
