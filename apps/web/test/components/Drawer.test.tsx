import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Drawer } from "../../components/ui/Drawer";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("Drawer", () => {
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

  it("renders the title, body, and footer when open", () => {
    act(() => {
      root.render(
        <Drawer open onOpenChange={() => undefined} title="Dividend details" footer={<div>Footer action</div>}>
          <div>Drawer body</div>
        </Drawer>,
      );
    });

    expect(document.querySelector("[data-testid='ui-drawer']")).not.toBeNull();
    expect(document.body.textContent).toContain("Dividend details");
    expect(document.body.textContent).toContain("Drawer body");
    expect(document.body.textContent).toContain("Footer action");
  });

  it("prompts before closing when the drawer is dirty", () => {
    const onOpenChange = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    act(() => {
      root.render(
        <Drawer
          open
          onOpenChange={onOpenChange}
          title="Dirty dividend"
          dirty
          dirtyConfirmMessage="Discard dividend changes?"
        >
          <div>Drawer body</div>
        </Drawer>,
      );
    });

    const closeButton = document.querySelector("[data-testid='ui-drawer-close']") as HTMLButtonElement;

    confirmSpy.mockReturnValueOnce(false);
    act(() => {
      closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmSpy).toHaveBeenCalledWith("Discard dividend changes?");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    confirmSpy.mockReturnValueOnce(true);
    act(() => {
      closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    confirmSpy.mockRestore();
  });
});
