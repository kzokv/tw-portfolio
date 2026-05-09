import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@tw-portfolio/test-framework/core";

/**
 * KZO-195 — POM for `/admin/instruments`. Per
 * `.claude/rules/responsive-dual-layout-testid-prefixes.md`, if a card variant
 * lands later it MUST use a distinct testid suffix (`-card-`); the desktop
 * table testids are the default below.
 *
 * Per `.claude/rules/playwright-page-object-testid-drift.md`: every locator
 * here must match a `data-testid` rendered by `AdminInstrumentsClient.tsx`.
 * On any locator rename, grep `apps/web/components/admin/AdminInstrumentsClient.tsx`
 * for the new testid string before merging.
 */
export interface TAdminInstrumentsElements extends TElementLocatorHelpers {
  page: Locator;
  table: Locator;
  row: (ticker: string) => Locator;
  statusChip: (ticker: string) => Locator;
  undeleteButton: (ticker: string) => Locator;
  excludeToggle: (ticker: string) => Locator;
  thresholdsPanel: Locator;
  thresholdsPanelLink: Locator;
}

export class AdminInstrumentsPage extends BasePage<TAdminInstrumentsElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      page: this.locate("admin-instruments-page", "Admin Instruments Page"),
      table: this.locate("admin-instruments-table", "Admin Instruments Table"),
      row: (ticker: string) =>
        this.locate(`instrument-row-${ticker}`, `Admin Instruments Row ${ticker}`),
      statusChip: (ticker: string) =>
        this.locate(
          `instrument-status-badge-${ticker}`,
          `Admin Instruments Status Chip ${ticker}`,
        ),
      undeleteButton: (ticker: string) =>
        this.locate(
          `instrument-undelete-btn-${ticker}`,
          `Admin Instruments Undelete Button ${ticker}`,
        ),
      excludeToggle: (ticker: string) =>
        this.locate(
          `instrument-exclude-toggle-btn-${ticker}`,
          `Admin Instruments Exclude Toggle ${ticker}`,
        ),
      thresholdsPanel: this.locate(
        "admin-instruments-thresholds",
        "Admin Instruments Thresholds Panel",
      ),
      thresholdsPanelLink: this.locate(
        "admin-instruments-thresholds-settings-link",
        "Admin Instruments Thresholds Link to /admin/settings",
      ),
    };
  }
}
