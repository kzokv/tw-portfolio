import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TDashboardElements {
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
  performancePartialWarning: Locator;
  returnPercentCard: Locator;
  returnPercentChart: Locator;
  returnPercentProvisionalWarning: Locator;
}

export class DashboardPage extends BasePage<TDashboardElements> {
  protected initializeElements(): void {
    this._elements = {
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
    };
  }
}
