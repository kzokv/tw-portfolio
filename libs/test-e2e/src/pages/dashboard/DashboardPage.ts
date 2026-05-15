import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

export interface TDashboardElements extends TElementLocatorHelpers {
  recomputeButton: Locator;
  recomputeStatus: Locator;
  demoBanner: Locator;
  appReady: Locator;
  summarySection: Locator;
  holdingsTable: Locator;
  holdingsSection: Locator;
  heroPanel: Locator;
  generateSnapshotsButton: Locator;
  snapshotStatus: Locator;
  performanceCard: Locator;
  performanceChart: Locator;
  performanceChartDataPath: Locator;
  performancePartialWarning: Locator;
  returnPercentCard: Locator;
  returnPercentChart: Locator;
  returnPercentChartDataPath: Locator;
  returnPercentProvisionalWarning: Locator;
  dailyChangeCard: Locator;
  dailyChangeSubduedText: Locator;
  holdingsHeaderCells: Locator;
  holdingRow: (ticker: string) => Locator;
  holdingDailyChangeCell: (ticker: string) => Locator;
}

export class DashboardPage extends BasePage<TDashboardElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      recomputeButton: this.locate("recompute-button", "Recompute Button"),
      recomputeStatus: this.locate("recompute-status", "Recompute Status"),
      demoBanner: this.locate("demo-banner", "Demo Banner"),
      appReady: this.locate("app-shell-ready", "App Shell Ready Marker"),
      summarySection: this.locate("dashboard-summary-section", "Dashboard Summary Section"),
      holdingsTable: this.locate("holdings-table", "Holdings Table"),
      holdingsSection: this.locate("dashboard-holdings-section", "Holdings Section"),
      heroPanel: this.locate("dashboard-intro", "Dashboard Hero Panel"),
      generateSnapshotsButton: this.locate("generate-snapshots-button", "Generate Snapshots Button"),
      snapshotStatus: this.locate("snapshot-status", "Snapshot Status"),
      performanceCard: this.locate("dashboard-performance-card", "Performance Amounts Card"),
      performanceChart: this.locate("dashboard-performance-chart", "Performance Amounts Chart SVG"),
      performancePartialWarning: this.locate("dashboard-performance-partial-warning", "Performance Partial Warning"),
      returnPercentCard: this.locate("dashboard-return-percent-card", "Return Percent Card"),
      returnPercentChart: this.locate("dashboard-return-percent-chart", "Return Percent Chart SVG"),
      returnPercentProvisionalWarning: this.locate("dashboard-return-percent-provisional-warning", "Return Percent Provisional Warning"),
      dailyChangeCard: this.withDescription(
        this.locate("dashboard-summary-section")
          .locator(".glass-inset")
          .filter({ hasText: /daily change/i }),
        "Daily Change Summary Card",
      ),
      dailyChangeSubduedText: this.withDescription(
        this.locate("dashboard-summary-section")
          .locator(".glass-inset")
          .filter({ hasText: /daily change/i })
          .locator("p.text-slate-400"),
        "Daily Change Subdued Text",
      ),
      holdingsHeaderCells: this.withinByCss(
        this.locate("holdings-table"),
        "thead th",
        "Holdings Table Header Cells",
      ),
      holdingRow: (ticker: string) =>
        this.withDescription(
          this.locate("holdings-table").locator("tbody tr").filter({ hasText: ticker }),
          `Holding Row ${ticker}`,
        ),
      holdingDailyChangeCell: (ticker: string) =>
        this.withDescription(
          this.locate("holdings-table").locator("tbody tr").filter({ hasText: ticker }).locator("td").nth(5),
          `Holding Daily Change Cell ${ticker}`,
        ),
      performanceChartDataPath: this.withinByCss(
        this.locate("dashboard-performance-chart"),
        "path[d]",
        "Performance Chart Data Path",
      ),
      returnPercentChartDataPath: this.withinByCss(
        this.locate("dashboard-return-percent-chart"),
        "path[d]",
        "Return Percent Chart Data Path",
      ),
    };
  }
}
