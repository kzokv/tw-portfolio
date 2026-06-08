import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPage(relativePath: string): string {
  const webRoot = process.cwd().endsWith("apps/web") ? process.cwd() : resolve(process.cwd(), "apps/web");
  const normalizedPath = relativePath.startsWith("apps/web/") ? relativePath.slice("apps/web/".length) : relativePath;
  return readFileSync(resolve(webRoot, normalizedPath), "utf8");
}

describe("heavy page server seeding source contracts", () => {
  it("[dashboard]: fetches and passes server-seeded primary data", () => {
    const source = readPage("apps/web/app/dashboard/page.tsx");

    expect(source).toContain("fetchDashboardPrimaryData().catch(() => null)");
    expect(source).toContain('getJson<UserPreferencesResponse>("/user-preferences").catch(() => null)');
    expect(source).toContain("expectedReportingCurrency={expectedReportingCurrency}");
    expect(source).toContain("initialPrimaryData={initialPrimaryData}");
    expect(source).toContain("accounts: initialPrimaryData.accounts");
    expect(source).toContain("feeProfiles: initialPrimaryData.feeProfiles");
    expect(source).toContain("feeProfileBindings: initialPrimaryData.feeProfileBindings");
  });

  it("[portfolio]: fetches and passes server-seeded primary data", () => {
    const source = readPage("apps/web/app/portfolio/page.tsx");

    expect(source).toContain("fetchPortfolioPrimaryData().catch(() => null)");
    expect(source).toContain('<PortfolioClient initialPrimaryData={initialPrimaryData} />');
    expect(source).toContain('portfolioConfigMode={initialPortfolioConfig ? "eager" : "lazy"}');
    expect(source).toContain("accounts: initialPrimaryData.accounts");
    expect(source).toContain("feeProfiles: initialPrimaryData.feeProfiles");
    expect(source).toContain("feeProfileBindings: initialPrimaryData.feeProfileBindings");
  });

  it("[transactions]: fetches and passes seeded transactions primary data instead of null", () => {
    const source = readPage("apps/web/app/transactions/page.tsx");

    expect(source).toContain("fetchTransactionsPrimaryData().catch(() => null)");
    expect(source).toContain("const initialPortfolioConfig = initialPrimaryData?.portfolioConfig ?? null;");
    expect(source).toContain("initialPrimaryData={initialPrimaryData}");
    expect(source).not.toContain("initialPrimaryData={null}");
  });
});
