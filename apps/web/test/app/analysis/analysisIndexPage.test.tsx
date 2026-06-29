import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

interface MockAppShellProps {
  children: ReactNode;
  section?: string;
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
    return <div data-testid="app-shell" data-section={props.section}>{props.children}</div>;
  },
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import AnalysisIndexPage from "../../../app/analysis/page";

describe("AnalysisIndexPage", () => {
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

  it("renders the analysis shell and entry card", async () => {
    const html = renderToStaticMarkup(await AnalysisIndexPage());

    expect(html).toContain('data-testid="app-shell"');
    expect(html).toContain('data-section="analysis"');
    expect(html).toContain("Analysis workspaces");
    expect(html).toContain("Unrealized P&amp;L");
    expect(html).toContain("/analysis/unrealized-pnl");
  });
});
