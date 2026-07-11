import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GrantShareDialog } from "../../../components/sharing/GrantShareDialog";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("GrantShareDialog", () => {
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

  it("includes dividend writes in the delegate manager preset", () => {
    act(() => {
      root.render(
        <GrantShareDialog
          open
          locale="en"
          onOpenChange={vi.fn()}
          onCreated={vi.fn()}
        />,
      );
    });

    const preset = document.querySelector<HTMLButtonElement>("[data-testid='grant-share-preset-delegateManager']");
    act(() => preset?.click());

    const dividendWrite = document.querySelector<HTMLInputElement>("[data-testid='grant-share-capability-dividend:write']");
    expect(dividendWrite?.checked).toBe(true);
  });
});
