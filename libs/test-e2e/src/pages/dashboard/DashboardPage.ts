import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

export interface TDashboardElements extends TElementLocatorHelpers {
  recomputeButton: Locator;
  recomputeStatus: Locator;
  demoBanner: Locator;
  appReady: Locator;
  holdingsTable: Locator;
  holdingsSection: Locator;
  heroPanel: Locator;
  // Phase 5d/5e — slim hero block (above the SortableCardGrid).
  dashboardHero: Locator;
  dashboardHeroTotal: Locator;
  dashboardHeroDayDelta: Locator;
  dashboardBiggestMovers: Locator;
  dashboardBiggestMoversEmpty: Locator;
  dashboardIntegrityAlert: Locator;
  dashboardIntegrityAlertCta: Locator;
  // Phase 5e — floating ⨁ Sheet (replaces ActionCenter recompute/snapshots).
  floatingQuickActionsTrigger: Locator;
  floatingQuickActionsSheet: Locator;
  floatingActionAddTransaction: Locator;
  floatingActionRecompute: Locator;
  floatingActionGenerateSnapshots: Locator;
  // Phase 5e — Recompute action opens an AlertDialog with this CTA.
  recomputeConfirmDialogCta: Locator;
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
  holdingsHeaderCells: Locator;
  holdingRow: (ticker: string) => Locator;
  holdingDailyChangeCell: (ticker: string) => Locator;
  biggestMoverRow: (ticker: string) => Locator;
}

export class DashboardPage extends BasePage<TDashboardElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      recomputeButton: this.locate("recompute-button", "Recompute Button"),
      recomputeStatus: this.locate("recompute-status", "Recompute Status"),
      demoBanner: this.locate("demo-banner", "Demo Banner"),
      appReady: this.locate("app-shell-ready", "App Shell Ready Marker"),
      holdingsTable: this.locate("holdings-table", "Holdings Table"),
      holdingsSection: this.locate("dashboard-holdings-section", "Holdings Section"),
      heroPanel: this.locate("dashboard-intro", "Dashboard Hero Panel"),
      dashboardHero: this.locate("dashboard-hero", "Dashboard Hero (Phase 5d)"),
      dashboardHeroTotal: this.locate("dashboard-hero-total", "Dashboard Hero Total"),
      dashboardHeroDayDelta: this.locate("dashboard-hero-day-delta", "Dashboard Hero Day Δ"),
      dashboardBiggestMovers: this.locate("dashboard-biggest-movers", "Dashboard Biggest Movers Card"),
      dashboardBiggestMoversEmpty: this.locate("dashboard-biggest-movers-empty", "Dashboard Biggest Movers Empty State"),
      dashboardIntegrityAlert: this.locate("dashboard-integrity-alert", "Dashboard Integrity Alert"),
      dashboardIntegrityAlertCta: this.locate("dashboard-integrity-alert-fix-cta", "Dashboard Integrity Alert Fix CTA"),
      floatingQuickActionsTrigger: this.locate("floating-quick-actions-trigger", "Floating Quick Actions Trigger"),
      floatingQuickActionsSheet: this.locate("floating-quick-actions-sheet", "Floating Quick Actions Sheet"),
      floatingActionAddTransaction: this.locate("floating-action-add-transaction", "Floating Action — Add Transaction"),
      floatingActionRecompute: this.locate("floating-action-recompute", "Floating Action — Recompute"),
      floatingActionGenerateSnapshots: this.locate("floating-action-generate-snapshots", "Floating Action — Generate Snapshots"),
      recomputeConfirmDialogCta: this.locate("recompute-confirm-dialog-cta", "Recompute Confirm Dialog CTA"),
      generateSnapshotsButton: this.locate("generate-snapshots-button", "Generate Snapshots Button"),
      snapshotStatus: this.locate("snapshot-status", "Snapshot Status"),
      performanceCard: this.locate("dashboard-performance-card", "Performance Amounts Card"),
      performanceChart: this.locate("dashboard-performance-chart", "Performance Amounts Chart SVG"),
      performancePartialWarning: this.locate("dashboard-performance-partial-warning", "Performance Partial Warning"),
      returnPercentCard: this.locate("dashboard-return-percent-card", "Return Percent Card"),
      returnPercentChart: this.locate("dashboard-return-percent-chart", "Return Percent Chart SVG"),
      returnPercentProvisionalWarning: this.locate("dashboard-return-percent-provisional-warning", "Return Percent Provisional Warning"),
      holdingsHeaderCells: this.withinByCss(
        this.locate("holdings-table"),
        "thead th",
        "Holdings Table Header Cells",
      ),
      holdingRow: (ticker: string) =>
        this.withDescription(
          this.locate("holdings-table").locator(`tbody tr[data-testid^="holding-group-row-${ticker}-"]`).first(),
          `Holding Row ${ticker}`,
        ),
      holdingDailyChangeCell: (ticker: string) =>
        this.withDescription(
          this.locate("holdings-table").locator(`[data-testid^="holding-group-daily-change-${ticker}-"]`).first(),
          `Holding Daily Change Cell ${ticker}`,
        ),
      biggestMoverRow: (ticker: string) =>
        this.locate(`dashboard-biggest-movers-row-${ticker}`, `Biggest Movers Row ${ticker}`),
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
