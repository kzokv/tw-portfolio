import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";
import { DividendPostingDrawerComponent, type TDividendPostingDrawerElements } from "./DividendPostingDrawerComponent.js";

export interface TDividendCalendarElements {
  calendarPage: Locator;
  monthInput: Locator;
  previousMonthButton: Locator;
  nextMonthButton: Locator;
  actionQueue: Locator;
  thisMonth: Locator;
  recentReceipts: Locator;
  tbdSection: Locator;
  // Phase 5a — Tabs container (calendar | ledger).
  tabsContainer: Locator;
  tabCalendar: Locator;
  tabLedger: Locator;
  tabpanelCalendar: Locator;
  tabpanelLedger: Locator;
  row: (eventId: string) => Locator;
  badge: (eventId: string) => Locator;
  postButton: (eventId: string) => Locator;
  editButton: (eventId: string) => Locator;
  markMatchedButton: (eventId: string) => Locator;
  drawer: TDividendPostingDrawerElements;
}

export class DividendCalendarPage extends BasePage<TDividendCalendarElements> {
  protected initializeElements(): void {
    this._elements = {
      calendarPage: this.locate("dividends-calendar-page", "Dividend Calendar Page"),
      monthInput: this.locate("dividends-month-input", "Dividends Month Input"),
      previousMonthButton: this.locate("dividends-previous-month", "Dividends Previous Month Button"),
      nextMonthButton: this.locate("dividends-next-month", "Dividends Next Month Button"),
      actionQueue: this.locate("dividends-action-queue", "Dividends Action Queue"),
      thisMonth: this.locate("dividends-this-month", "Dividends This Month Section"),
      recentReceipts: this.locate("dividends-recent-receipts", "Dividends Recent Receipts Section"),
      tbdSection: this.locate("dividends-tbd-section", "Dividend Payment Date TBD Section"),
      tabsContainer: this.locate("dividends-tabs", "Dividends Tabs Container"),
      tabCalendar: this.locate("dividends-tab-calendar", "Dividends Calendar Tab"),
      tabLedger: this.locate("dividends-tab-ledger", "Dividends Ledger Tab"),
      tabpanelCalendar: this.locate("dividends-tabpanel-calendar", "Dividends Calendar Panel"),
      tabpanelLedger: this.locate("dividends-tabpanel-ledger", "Dividends Ledger Panel"),
      row: (eventId: string) => this.locate(`dividend-row-${eventId}`, `Dividend Row ${eventId}`),
      badge: (eventId: string) =>
        this.withDescription(
          this.locate(`dividend-row-${eventId}`).getByTestId(`dividend-badge-${eventId}`),
          `Dividend Badge ${eventId}`,
        ),
      postButton: (eventId: string) => this.locate(`dividend-post-${eventId}`, `Post Dividend Button ${eventId}`),
      editButton: (eventId: string) => this.locate(`dividend-edit-${eventId}`, `Edit Dividend Button ${eventId}`),
      markMatchedButton: (eventId: string) => this.locate(`dividend-mark-matched-${eventId}`, `Mark Dividend Matched Button ${eventId}`),
      drawer: new DividendPostingDrawerComponent(this.page).elements,
    };
  }
}
