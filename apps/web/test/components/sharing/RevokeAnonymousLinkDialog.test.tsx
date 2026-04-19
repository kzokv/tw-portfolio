import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RevokeAnonymousLinkDialog } from "../../../components/sharing/RevokeAnonymousLinkDialog";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

describe("RevokeAnonymousLinkDialog", () => {
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

  it("renders a confirm dialog with revoke copy when open", () => {
    act(() => {
      root.render(
        <RevokeAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          onConfirm={vi.fn()}
          onOpenChange={vi.fn()}
        />,
      );
    });
    const dialog = document.querySelector("[data-testid='confirm-dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent?.toLowerCase()).toContain("revoke this public link");
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    act(() => {
      root.render(
        <RevokeAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          onConfirm={onConfirm}
          onOpenChange={vi.fn()}
        />,
      );
    });

    const btn = document.querySelector("[data-testid='confirm-dialog-confirm']") as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
