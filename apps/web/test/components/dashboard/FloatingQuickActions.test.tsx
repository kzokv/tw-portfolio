import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingQuickActions } from "../../../components/dashboard/FloatingQuickActions";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../lib/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../../../components/ui/shadcn/select", () => {
  let currentOnValueChange: ((value: string) => void) | null = null;
  let currentDisabled = false;
  return {
    Select: ({
      children,
      disabled = false,
      onValueChange,
    }: {
      children: ReactNode;
      disabled?: boolean;
      onValueChange: (value: string) => void;
    }) => {
      currentOnValueChange = onValueChange;
      currentDisabled = disabled;
      return <div>{children}</div>;
    },
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
      <button
        type="button"
        onClick={() => {
          if (!currentDisabled) currentOnValueChange?.(value);
        }}
      >
        {children}
      </button>
    ),
    SelectTrigger: ({ children, ...props }: { children: ReactNode }) => <button type="button" {...props}>{children}</button>,
    SelectValue: () => <span />,
  };
});

describe("FloatingQuickActions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders global actions and reporting currency controls when visible", async () => {
    const onReportingCurrencyChange = vi.fn(async () => undefined);

    act(() => {
      root.render(
        <FloatingQuickActions
          hidden={false}
          open
          onOpenChange={() => undefined}
          reportingCurrency="TWD"
          onReportingCurrencyChange={onReportingCurrencyChange}
          isReportingCurrencySaving={false}
          reportingCurrencyError=""
          onAddTransaction={() => undefined}
          onRecompute={() => undefined}
          onGenerateSnapshots={() => undefined}
          isGeneratingSnapshots={false}
          dict={getDictionary("en")}
        />,
      );
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Quick actions");
    expect(document.body.textContent).toContain("Add transaction");
    expect(document.body.textContent).toContain("Generate snapshots for current context");
    expect(document.body.textContent).toContain("Change reporting currency");
    expect(document.body.textContent).toContain("TWD");

    const usdButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "USD");
    expect(usdButton).not.toBeNull();
  });

  it("does not render when hidden", async () => {
    act(() => {
      root.render(
        <FloatingQuickActions
          hidden
          open={false}
          onOpenChange={() => undefined}
          reportingCurrency="TWD"
          onReportingCurrencyChange={async () => undefined}
          isReportingCurrencySaving={false}
          reportingCurrencyError=""
          onAddTransaction={() => undefined}
          onRecompute={() => undefined}
          onGenerateSnapshots={() => undefined}
          isGeneratingSnapshots={false}
          dict={getDictionary("en")}
        />,
      );
    });

    await act(async () => {});

    expect(document.body.textContent).toBe("");
  });

  it("saves reporting currency changes from the Quick Actions control", async () => {
    const onReportingCurrencyChange = vi.fn(async () => undefined);

    act(() => {
      root.render(
        <FloatingQuickActions
          hidden={false}
          open
          onOpenChange={() => undefined}
          reportingCurrency="TWD"
          onReportingCurrencyChange={onReportingCurrencyChange}
          isReportingCurrencySaving={false}
          reportingCurrencyError=""
          onAddTransaction={() => undefined}
          onRecompute={() => undefined}
          onGenerateSnapshots={() => undefined}
          isGeneratingSnapshots={false}
          dict={getDictionary("en")}
        />,
      );
    });

    await act(async () => {});

    const usdButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "USD");
    expect(usdButton).not.toBeNull();

    await act(async () => {
      usdButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReportingCurrencyChange).toHaveBeenCalledWith("USD");
    expect(document.body.textContent).toContain("Saved");
  });
});
