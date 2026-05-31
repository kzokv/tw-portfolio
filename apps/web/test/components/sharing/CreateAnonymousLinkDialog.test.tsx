import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CreateAnonymousLinkDialog } from "../../../components/sharing/CreateAnonymousLinkDialog";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("CreateAnonymousLinkDialog", () => {
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

  it("does not render when open=false", () => {
    act(() => {
      root.render(
        <CreateAnonymousLinkDialog
          open={false}
          locale="en"
          isSubmitting={false}
          error={null}
          onSubmit={vi.fn()}
          onOpenChange={vi.fn()}
        />,
      );
    });
    expect(document.querySelector("[data-testid='create-public-link-dialog']")).toBeNull();
  });

  it("submits 30 (default) when user clicks Create without changing selection", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <CreateAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          error={null}
          onSubmit={onSubmit}
          onOpenChange={vi.fn()}
        />,
      );
    });

    const submit = document.querySelector("[data-testid='create-public-link-submit']") as HTMLButtonElement;
    act(() => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(30);
  });

  it("submits 7 when 7-day option is selected", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <CreateAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          error={null}
          onSubmit={onSubmit}
          onOpenChange={vi.fn()}
        />,
      );
    });

    const opt7 = document.querySelector("[data-testid='create-public-link-expiry-7']") as HTMLInputElement;
    act(() => {
      opt7.click();
    });
    const submit = document.querySelector("[data-testid='create-public-link-submit']") as HTMLButtonElement;
    act(() => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith(7);
  });

  it("submits custom value when Custom is selected with a valid integer", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <CreateAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          error={null}
          onSubmit={onSubmit}
          onOpenChange={vi.fn()}
        />,
      );
    });

    const optCustom = document.querySelector("[data-testid='create-public-link-expiry-custom']") as HTMLInputElement;
    act(() => {
      optCustom.click();
    });
    const customInput = document.querySelector("[data-testid='create-public-link-expiry-custom-input']") as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      nativeSetter.call(customInput, "42");
      customInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = document.querySelector("[data-testid='create-public-link-submit']") as HTMLButtonElement;
    act(() => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmit).toHaveBeenCalledWith(42);
  });

  it("shows validation error and does NOT call onSubmit when custom value is out of range", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <CreateAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          error={null}
          onSubmit={onSubmit}
          onOpenChange={vi.fn()}
        />,
      );
    });

    const optCustom = document.querySelector("[data-testid='create-public-link-expiry-custom']") as HTMLInputElement;
    act(() => {
      optCustom.click();
    });
    const customInput = document.querySelector("[data-testid='create-public-link-expiry-custom-input']") as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      nativeSetter.call(customInput, "0");
      customInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = document.querySelector("[data-testid='create-public-link-submit']") as HTMLButtonElement;
    act(() => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    const err = document.querySelector("[data-testid='create-public-link-error']");
    expect(err).not.toBeNull();
  });

  it("displays an external error banner when error prop is set", () => {
    act(() => {
      root.render(
        <CreateAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          error="At capacity — revoke an existing link first."
          onSubmit={vi.fn()}
          onOpenChange={vi.fn()}
        />,
      );
    });

    const err = document.querySelector("[data-testid='create-public-link-error']");
    expect(err?.textContent).toContain("At capacity");
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    act(() => {
      root.render(
        <CreateAnonymousLinkDialog
          open
          locale="en"
          isSubmitting={false}
          error={null}
          onSubmit={vi.fn()}
          onOpenChange={onOpenChange}
        />,
      );
    });

    const cancel = document.querySelector("[data-testid='create-public-link-cancel']") as HTMLButtonElement;
    act(() => {
      cancel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
