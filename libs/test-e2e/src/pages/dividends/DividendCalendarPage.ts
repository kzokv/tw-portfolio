import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";
import { DividendPostingDrawerComponent, type TDividendPostingDrawerElements } from "./DividendPostingDrawerComponent.js";

export interface TDividendCalendarElements {
  calendarPage: Locator;
  tbdSection: Locator;
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
      tbdSection: this.locate("dividends-tbd-section", "Dividend Payment Date TBD Section"),
      row: (eventId: string) => this.locate(`dividend-row-${eventId}`, `Dividend Row ${eventId}`),
      badge: (eventId: string) => this.locate(`dividend-badge-${eventId}`, `Dividend Badge ${eventId}`),
      postButton: (eventId: string) => this.locate(`dividend-post-${eventId}`, `Post Dividend Button ${eventId}`),
      editButton: (eventId: string) => this.locate(`dividend-edit-${eventId}`, `Edit Dividend Button ${eventId}`),
      markMatchedButton: (eventId: string) => this.locate(`dividend-mark-matched-${eventId}`, `Mark Dividend Matched Button ${eventId}`),
      drawer: new DividendPostingDrawerComponent(this.page).elements,
    };
  }
}
