import { describe, expect, it } from "vitest";
import { resolveBreadcrumbTitle, resolveExactBreadcrumbTitle } from "../../lib/breadcrumb-titles";

describe("breadcrumb title fallbacks", () => {
  it("keeps longest-prefix page fallback separate from exact segment labels", () => {
    expect(resolveBreadcrumbTitle("/admin/market-data/KR/overview")).toBe("Market Data");
    expect(resolveExactBreadcrumbTitle("/admin/market-data")).toBe("Market Data");
    expect(resolveExactBreadcrumbTitle("/admin/market-data/KR")).toBeNull();
    expect(resolveExactBreadcrumbTitle("/admin/market-data/KR/overview")).toBeNull();
  });
});
