import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppShellDataProvider, type AppShellData } from "../../../components/layout/AppShellDataContext";
import { Breadcrumb } from "../../../components/layout/Breadcrumb";
import { BreadcrumbProvider } from "../../../components/layout/BreadcrumbProvider";
import { getDictionary } from "../../../lib/i18n";

let mockPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildShellData(locale: "en" | "zh-TW"): AppShellData {
  return {
    uiDict: getDictionary(locale),
    locale,
  } as AppShellData;
}

describe("Breadcrumb zh-TW guardrails", () => {
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

  it("renders top-level fallback breadcrumbs from the zh-TW navigation dictionary", async () => {
    mockPathname = "/transactions";

    await act(async () => {
      root.render(
        <AppShellDataProvider value={buildShellData("zh-TW")}>
          <BreadcrumbProvider>
            <Breadcrumb />
          </BreadcrumbProvider>
        </AppShellDataProvider>,
      );
    });

    expect(document.querySelector("[data-testid='breadcrumb-item-0']")?.textContent).toContain("交易紀錄");
  });

  it("renders settings fallbacks in zh-TW instead of the static English map", async () => {
    mockPathname = "/settings/general";

    await act(async () => {
      root.render(
        <AppShellDataProvider value={buildShellData("zh-TW")}>
          <BreadcrumbProvider>
            <Breadcrumb />
          </BreadcrumbProvider>
        </AppShellDataProvider>,
      );
    });

    expect(document.querySelector("[data-testid='breadcrumb-item-0']")?.textContent).toContain("設定");
    expect(document.querySelector("[data-testid='breadcrumb-item-1']")?.textContent).toContain("一般");
  });
});
