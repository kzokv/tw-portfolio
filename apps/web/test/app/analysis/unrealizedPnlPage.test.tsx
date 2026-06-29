import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

interface MockAppShellProps {
  children: ReactNode;
  portfolioConfigMode?: string;
  section?: string;
}

interface MockClientProps {
  initialData: null;
  initialState: {
    range: string;
    granularity: string;
    reportingCurrency: string;
  };
}

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell(props: MockAppShellProps) {
    return (
      <div
        data-testid="app-shell"
        data-portfolio-config-mode={props.portfolioConfigMode}
        data-section={props.section}
      >
        {props.children}
      </div>
    );
  },
}));

vi.mock("../../../components/analysis/UnrealizedPnlAnalysisClient", () => ({
  UnrealizedPnlAnalysisClient(props: MockClientProps) {
    return (
      <div
        data-testid="analysis-client"
        data-range={props.initialState.range}
        data-granularity={props.initialState.granularity}
        data-currency={props.initialState.reportingCurrency}
      />
    );
  },
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import UnrealizedPnlPage from "../../../app/analysis/unrealized-pnl/page";

describe("UnrealizedPnlPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue({ isDemo: false } as never);
    vi.mocked(getJson).mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/profile") return {};
      return {};
    }) as never);
    vi.mocked(readSidebarStateCookie).mockResolvedValue(false as never);
  });

  it("passes validated analysis state into the client route shell", async () => {
    const html = renderToStaticMarkup(await UnrealizedPnlPage({
      searchParams: Promise.resolve({
        range: "ALL",
        granularity: "weekly",
        currency: "USD",
      }),
    }));

    expect(html).toContain('data-testid="app-shell"');
    expect(html).toContain('data-section="analysis"');
    expect(html).toContain('data-portfolio-config-mode="lazy"');
    expect(html).toContain('data-testid="analysis-client"');
    expect(html).toContain('data-range="5Y"');
    expect(html).toContain('data-granularity="weekly"');
    expect(html).toContain('data-currency="USD"');
  });
});
