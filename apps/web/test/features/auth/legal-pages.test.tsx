import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: () => "en-US",
  })),
}));
vi.mock("../../../components/layout/ThemeToggle", () => ({
  ThemeToggle: function MockThemeToggle() {
    const R = (globalThis as Record<string, unknown>).React as typeof import("react");
    return R.createElement("div", { "data-testid": "theme-toggle-mock" }, "theme toggle");
  },
}));

import PrivacyPage from "../../../app/privacy/page";
import TermsPage from "../../../app/terms/page";

describe("legal pages", () => {
  it("renders the terms destination linked from auth footers", async () => {
    const html = renderToStaticMarkup(await TermsPage());

    expect(html).toContain("Terms of Use");
    expect(html).toContain("No financial advice");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/privacy"');
  });

  it("renders the privacy destination linked from auth footers", async () => {
    const html = renderToStaticMarkup(await PrivacyPage());

    expect(html).toContain("Privacy Notice");
    expect(html).toContain("Account data");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/terms"');
  });
});
