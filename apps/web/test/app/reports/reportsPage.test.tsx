import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

interface MockAppShellProps {
  children: ReactNode;
  portfolioConfigMode?: string;
  section?: string;
}

interface MockReportsClientProps {
  initialReport?: { query?: { scope?: string } } | null;
  initialState: {
    tab: string;
    scope: string;
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

vi.mock("../../../features/reports/services/reportService", () => ({
  fetchReport: vi.fn(),
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

vi.mock("../../../components/reports/ReportsClient", () => ({
  ReportsClient(props: MockReportsClientProps) {
    return (
      <div
        data-testid="reports-client"
        data-report-scope={props.initialReport?.query?.scope ?? ""}
        data-state-tab={props.initialState.tab}
        data-state-scope={props.initialState.scope}
      />
    );
  },
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchReport } from "../../../features/reports/services/reportService";
import ReportsPage from "../../../app/reports/page";

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue({ isDemo: false } as never);
    vi.mocked(getJson).mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/profile") return {};
      return {};
    }) as never);
    vi.mocked(readSidebarStateCookie).mockResolvedValue(false as never);
    vi.mocked(fetchReport).mockResolvedValue({
      query: { scope: "US" },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("server-seeds the active report from validated query state", async () => {
    const html = renderToStaticMarkup(await ReportsPage({
      searchParams: Promise.resolve({
        tab: "market",
        scope: "US",
        currencyMode: "specified",
        currency: "USD",
      }),
    }));

    expect(html).toContain('data-testid="app-shell"');
    expect(html).toContain('data-section="reports"');
    expect(html).toContain('data-portfolio-config-mode="lazy"');
    expect(html).toContain('data-testid="reports-client"');
    expect(html).toContain('data-state-tab="market"');
    expect(html).toContain('data-state-scope="US"');
    expect(html).toContain('data-report-scope="US"');
    expect(fetchReport).toHaveBeenCalledWith("market", expect.objectContaining({
      scope: "US",
      currencyMode: "specified",
      currency: "USD",
    }));
  });

  it("renders the report shell when the active report seed exceeds the paint budget", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchReport).mockImplementation(() => new Promise(() => {}) as never);

    const pagePromise = ReportsPage({
      searchParams: Promise.resolve({
        tab: "daily-review",
        scope: "TW",
      }),
    });

    await vi.advanceTimersByTimeAsync(1_500);
    const html = renderToStaticMarkup(await pagePromise);

    expect(html).toContain('data-testid="reports-client"');
    expect(html).toContain('data-state-tab="daily-review"');
    expect(html).toContain('data-state-scope="TW"');
    expect(html).toContain('data-report-scope=""');
    expect(fetchReport).toHaveBeenCalledWith("daily-review", expect.objectContaining({
      scope: "TW",
    }));
  });
});
