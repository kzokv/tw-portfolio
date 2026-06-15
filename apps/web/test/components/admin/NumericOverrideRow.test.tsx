import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NumericOverrideRow } from "../../../components/admin/NumericOverrideRow";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("NumericOverrideRow", () => {
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

  it("accepts decimal overrides when a decimal step is configured", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <NumericOverrideRow
          bounds={{ min: 0, max: 100 }}
          effective={10}
          fieldKey="decimal-threshold"
          label="Decimal threshold"
          onSave={onSave}
          override={null}
          step="any"
        />,
      );
    });

    const toggle = container.querySelector<HTMLInputElement>("[data-testid='admin-settings-decimal-threshold-toggle']");

    await act(async () => {
      toggle?.click();
    });
    const input = container.querySelector<HTMLInputElement>("[data-testid='admin-settings-decimal-threshold-input']");
    const save = container.querySelector<HTMLButtonElement>("[data-testid='admin-settings-decimal-threshold-save-button']");
    await act(async () => {
      setInputValue(input!, "0.5");
    });
    await act(async () => {
      save?.click();
    });

    expect(onSave).toHaveBeenCalledWith(0.5);
    expect(container.querySelector("[data-testid='admin-settings-decimal-threshold-validation-error']")).toBeNull();
  });

  it("keeps whole-number validation as the default", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <NumericOverrideRow
          bounds={{ min: 0, max: 100 }}
          effective={10}
          fieldKey="integer-threshold"
          label="Integer threshold"
          onSave={onSave}
          override={null}
        />,
      );
    });

    const toggle = container.querySelector<HTMLInputElement>("[data-testid='admin-settings-integer-threshold-toggle']");

    await act(async () => {
      toggle?.click();
    });
    const input = container.querySelector<HTMLInputElement>("[data-testid='admin-settings-integer-threshold-input']");
    const save = container.querySelector<HTMLButtonElement>("[data-testid='admin-settings-integer-threshold-save-button']");
    await act(async () => {
      setInputValue(input!, "0.5");
    });
    await act(async () => {
      save?.click();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='admin-settings-integer-threshold-validation-error']")).not.toBeNull();
  });
});
