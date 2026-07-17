import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";
import { DividendPostingDrawerComponent, type TDividendPostingDrawerElements } from "./DividendPostingDrawerComponent.js";

export interface TDividendReviewElements extends TElementLocatorHelpers {
  // Root
  page: Locator;

  // Filter bar — presets
  presetStrip: Locator;
  preset: (name: string) => Locator;
  yearRangeTrigger: Locator;
  yearOption: (year: number) => Locator;

  // Filter bar — date inputs
  dateFrom: Locator;
  dateTo: Locator;
  dateError: Locator;

  // Filter bar — dropdowns and inputs
  tickerInput: Locator;
  statusSelect: Locator;
  accountSelect: Locator;

  // Stats tiles
  statTiles: Locator;
  statOpenItems: Locator;

  // Charts
  chartsContainer: Locator;
  chartTab: (key: string) => Locator;
  granularityToggle: Locator;
  currencySelect: Locator;

  // Table (desktop)
  table: Locator;
  rows: Locator;
  rowSkeletons: Locator;
  tableHeader: (field: string) => Locator;
  tableHeaderCell: (field: string) => Locator;
  mobileSortControls: Locator;
  mobileSortField: Locator;
  mobileSortDirection: Locator;
  chartGranularityButton: (level: string) => Locator;
  chartsAreaPaths: Locator;
  chartsBars: Locator;
  pendingLink: Locator;
  row: (id: string) => Locator;
  rowStatusBadge: (id: string) => Locator;
  markMatchedButton: (id: string) => Locator;

  // Pagination
  pagination: Locator;
  paginationPrev: Locator;
  paginationNext: Locator;
  pageSize: Locator;

  primaryError: Locator;
  primaryRetry: Locator;
  primaryRefreshing: Locator;
  enrichmentLoading: Locator;
  enrichmentError: Locator;
  enrichmentRetry: Locator;
  enrichmentRefreshing: Locator;

  drawerLoading: Locator;
  drawerError: Locator;
  drawerRetry: Locator;
  removalGuidance: Locator;
  openTickerTransactions: Locator;

  // Drawer (reused from KZO-32)
  drawer: TDividendPostingDrawerElements;

  // NHI rollup section (KZO-134)
  nhiRollupSection: Locator;
  nhiRollupEmpty: Locator;
  nhiRollupPendingLink: Locator;
  nhiRollupPremium: Locator;
}

export class DividendReviewPage extends BasePage<TDividendReviewElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      // Root
      page: this.locate("dividend-review-page", "Dividend Review Page"),

      // Filter bar — presets
      presetStrip: this.locate("preset-strip", "Preset Strip"),
      preset: (name: string) => this.locate(`preset-${name}`, `Preset ${name}`),
      yearRangeTrigger: this.locate("preset-year-range", "Year Range Trigger"),
      yearOption: (year: number) => this.locate(`preset-year-${year}`, `Preset Year ${year}`),

      // Filter bar — date inputs
      dateFrom: this.locate("filter-from-date", "Date From Input"),
      dateTo: this.locate("filter-to-date", "Date To Input"),
      dateError: this.locate("date-error", "Date Error"),

      // Filter bar — dropdowns and inputs
      tickerInput: this.locate("filter-ticker", "Ticker Input"),
      statusSelect: this.locate("filter-cash-status", "Cash Status Select"),
      accountSelect: this.locate("filter-account", "Account Select"),

      // Stats tiles
      statTiles: this.locate("stat-tiles", "Stats Tiles"),
      statOpenItems: this.locate("stat-needs-attention", "Needs Attention Tile"),

      // Charts
      chartsContainer: this.locate("dividend-review-charts", "Charts Container"),
      chartTab: (key: string) => this.locate(`chart-tab-${key}`, `Chart Tab ${key}`),
      granularityToggle: this.locate("chart-granularity-toggle", "Granularity Toggle"),
      currencySelect: this.locate("chart-currency-selector", "Currency Select"),

      // Table (desktop)
      table: this.locate("review-table", "Dividend Review Table"),
      rows: this.withDescription(
        this.scope.locator('[data-testid^="review-row-"]:not([data-testid="review-row-skeleton"]):not([data-testid$="-open"])'),
        "Dividend Review Rows",
      ),
      rowSkeletons: this.locate("review-row-skeleton", "Dividend Review Row Skeletons"),
      tableHeader: (field: string) =>
        this.locate(
          field === "varianceAmount"
            ? "review-sort-variance"
            : `review-sort-${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
          `Dividend Review ${field} Header`,
        ),
      tableHeaderCell: (field: string) =>
        this.withDescription(
          this.locate(
            field === "varianceAmount"
              ? "review-sort-variance"
              : `review-sort-${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
            `Dividend Review ${field} Header Button`,
          ).locator(".."),
          `Dividend Review ${field} Header Cell`,
        ),
      mobileSortControls: this.locate("review-mobile-sort-controls", "Mobile Sort Controls"),
      mobileSortField: this.locate("review-mobile-sort-field", "Mobile Sort Field"),
      mobileSortDirection: this.locate("review-mobile-sort-direction", "Mobile Sort Direction"),
      chartGranularityButton: (level: string) =>
        this.withDescription(
          this.locate("chart-granularity-toggle").locator("button").filter({ hasText: new RegExp(level, "i") }),
          `Chart Granularity ${level}`,
        ),
      chartsAreaPaths: this.withinByCss(
        this.locate("dividend-review-charts"),
        ".recharts-area",
        "Dividend Review Chart Areas",
      ),
      chartsBars: this.withinByCss(
        this.locate("dividend-review-charts"),
        ".recharts-bar",
        "Dividend Review Chart Bars",
      ),
      pendingLink: this.locateByRole("link", {
        name: /View all dividends|查看所有股利/i,
        description: "View All Dividends Link",
      }),
      row: (id: string) => this.locate(`review-row-${id}`, `Row ${id}`),
      rowStatusBadge: (id: string) =>
        this.locate(`dividend-review-status-${id}`, `Row ${id} Status Badge`),
      markMatchedButton: (id: string) => this.locate(`mark-matched-${id}`, `Mark Matched ${id}`),

      // Pagination
      pagination: this.locate("pagination", "Pagination"),
      paginationPrev: this.locate("pagination-prev", "Previous Page"),
      paginationNext: this.locate("pagination-next", "Next Page"),
      pageSize: this.locate("review-page-size", "Review Page Size"),

      primaryError: this.locate("review-error", "Review Primary Error"),
      primaryRetry: this.locate("review-primary-retry", "Review Primary Retry"),
      primaryRefreshing: this.locate("review-refreshing", "Review Primary Refreshing"),
      enrichmentLoading: this.locate("review-enrichment-loading", "Review Enrichment Loading"),
      enrichmentError: this.locate("review-enrichment-error", "Review Enrichment Error"),
      enrichmentRetry: this.locate("review-enrichment-retry", "Review Enrichment Retry"),
      enrichmentRefreshing: this.locate("review-enrichment-refreshing", "Review Enrichment Refreshing"),

      drawerLoading: this.locate("review-drawer-loading", "Review Drawer Loading"),
      drawerError: this.locate("review-drawer-error", "Review Drawer Error"),
      drawerRetry: this.locate("review-drawer-retry", "Review Drawer Retry"),
      removalGuidance: this.locate("dividend-removal-guidance", "Dividend Removal Guidance"),
      openTickerTransactions: this.withDescription(
        this.locate("dividend-removal-guidance").getByRole("link"),
        "Open Ticker Transactions Link",
      ),

      // Drawer (reused from KZO-32)
      drawer: new DividendPostingDrawerComponent(this.page).elements,

      // NHI rollup section (KZO-134)
      nhiRollupSection: this.locate("nhi-rollup-section", "NHI Rollup Section"),
      nhiRollupEmpty: this.locate("nhi-rollup-empty", "NHI Rollup Empty State"),
      nhiRollupPendingLink: this.locate("nhi-rollup-pending-link", "NHI Rollup Pending Link"),
      nhiRollupPremium: this.locate("nhi-rollup-premium", "NHI Rollup Premium"),
    };
  }
}
