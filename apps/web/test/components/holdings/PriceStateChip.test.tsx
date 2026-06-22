// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDictionary } from "../../../lib/i18n/types";
import { getDictionary } from "../../../lib/i18n";
import { CalendarUnknownWarnings } from "../../../components/holdings/CalendarUnknownWarnings";
import { PriceStateChip } from "../../../components/holdings/PriceStateChip";

const dict = {
  holdings: {
    priceStateUpdated: "Updated {relative}",
    priceStateDelayed: "Delayed {relative}",
    priceStatePreviousClose: "Previous close",
    priceStateClosed: "Closed",
    priceStateStale: "Stale close",
    priceStateUnavailable: "Unavailable",
    priceStateBasisLabel: "Basis",
    priceStateMarketStateLabel: "Market",
    priceStateAsOfLabel: "As of",
    priceStateObservedAtLabel: "Observed",
    priceStateSourceLabel: "Source",
    priceStateQualityLabel: "Quality",
    priceStateDelayLabel: "Delay",
    priceStateTimeZoneLabel: "Time zone",
    priceStateCalendarLabel: "Calendar",
    priceStateCalendarReasonLabel: "Calendar reason",
    priceStateMarketLocalDateLabel: "Market date",
    priceStateYahooSymbolLabel: "Yahoo symbol",
    priceStateCadenceLabel: "Cadence",
    priceStateLatestAttemptLabel: "Latest attempt",
    priceStateLatestOutcomeLabel: "Latest outcome",
    priceStateActivityHintLabel: "Activity",
    priceStateCloseDetailsLabel: "Close",
    priceStateFullDailyBarLabel: "Full daily bar",
    priceStatePendingValue: "Pending",
    priceStateSourceYahooChart: "Yahoo chart",
    priceStateSourceYahooClose: "Yahoo close",
    priceStateSourceTwseClose: "TWSE close",
    priceStateSourcePrimaryDaily: "Daily bar",
    calendarUnknownWarningTitle: "Market calendar needs attention",
    calendarUnknownWarningMessage: "{market} market calendar for {year} is missing. Today in {location} is {date}. Seed it in Admin Market Data or with the admin MCP calendar tool.",
    priceStateUnknownValue: "Unknown",
    priceStateBasisIntraday: "Intraday",
    priceStateBasisDelayedIntraday: "Delayed intraday",
    priceStateBasisPreviousClose: "Previous close",
    priceStateBasisTodayClose: "Today close",
    priceStateBasisPendingTodayClose: "Pending today close",
    priceStateBasisStaleClose: "Stale close",
    priceStateBasisMissing: "Missing",
    priceStateMarketOpen: "Open",
    priceStateMarketClosed: "Closed",
    priceStateQualityFullBar: "Full bar",
    priceStateQualityCloseOnly: "Close only",
    priceStateDelaySeconds: "{count} seconds",
    priceStateDelayMinutes: "{count} minutes",
  },
} as unknown as AppDictionary;
const zhDict = getDictionary("zh-TW");

function createPointerEvent(type: string, pointerType: "mouse" | "touch"): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

describe("PriceStateChip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renders nothing when price state is absent", async () => {
    act(() => {
      root.render(<PriceStateChip dict={dict} locale="en" priceState={null} testId="price-state-chip" />);
    });

    await act(async () => {});

    expect(container.innerHTML).toBe("");
  });

  it("renders an open-market fresh label with the success tone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T10:00:00.000Z"));

    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "intraday",
            chipState: "open_fresh",
            marketState: "open",
            source: "yahoo-chart",
            sourceKind: "intraday_yahoo_chart",
            asOfDate: "2026-06-17",
            asOfTimestamp: "2026-06-17T10:00:00.000Z",
            observedAt: "2026-06-17T10:00:00.000Z",
            delaySeconds: 120,
            marketTimeZone: "America/New_York",
            quality: null,
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']");
    expect(chip?.textContent).toContain("Updated now");
    expect(chip?.querySelector("[aria-hidden='true']")?.className).toContain("bg-[hsl(var(--success))]");
  });

  it("renders delayed and closed states with the expected labels and tones", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "delayed_intraday",
            chipState: "open_delayed",
            marketState: "open",
            source: "yahoo-chart",
            sourceKind: "intraday_yahoo_chart",
            asOfDate: "2026-06-17",
            asOfTimestamp: "2026-06-17T10:15:00.000Z",
            observedAt: "2026-06-17T10:15:00.000Z",
            delaySeconds: 1800,
            marketTimeZone: "America/New_York",
            quality: "close_only",
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']");
    expect(chip?.textContent).toContain("Delayed");
    expect(chip?.querySelector("[aria-hidden='true']")?.className).toContain("bg-warning");

    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "today_close",
            chipState: "closed",
            marketState: "closed",
            source: "daily-provider",
            sourceKind: "primary_daily",
            asOfDate: "2026-06-17",
            asOfTimestamp: null,
            observedAt: null,
            delaySeconds: null,
            marketTimeZone: "Asia/Taipei",
            quality: "full_bar",
          }}
        />,
      );
    });

    await act(async () => {});

    const closedChip = document.querySelector("[data-testid='price-state-chip']");
    expect(closedChip?.textContent).toContain("Closed");
    expect(closedChip?.querySelector("[aria-hidden='true']")?.className).toContain("bg-slate-400");

    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "pending_today_close",
            chipState: "closed_pending",
            marketState: "closed",
            source: "yahoo-finance-chart",
            sourceKind: "intraday_yahoo_chart",
            asOfDate: "2026-06-18",
            asOfTimestamp: "2026-06-18T05:30:00.000Z",
            observedAt: "2026-06-18T05:31:00.000Z",
            delaySeconds: 1800,
            marketTimeZone: "Asia/Taipei",
            quality: null,
          }}
        />,
      );
    });

    await act(async () => {});

    const pendingCloseChip = document.querySelector("[data-testid='price-state-chip']");
    expect(pendingCloseChip?.textContent).toContain("Pending today close");
    expect(pendingCloseChip?.querySelector("[aria-hidden='true']")?.className).toContain("bg-warning");
  });

  it("can render as non-interactive text for use inside another button", async () => {
    act(() => {
      root.render(
        <button type="button">
          <PriceStateChip
            dict={dict}
            interactive={false}
            locale="en"
            testId="price-state-chip"
            priceState={{
              basis: "today_close",
              chipState: "closed",
              marketState: "closed",
              source: "daily-provider",
              sourceKind: "primary_daily",
              asOfDate: "2026-06-17",
              asOfTimestamp: null,
              observedAt: null,
              delaySeconds: null,
              marketTimeZone: "Asia/Taipei",
              quality: "full_bar",
            }}
          />
        </button>,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']");
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.textContent).toContain("Closed");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("uses a popover disclosure by default for mouse and touch interactions", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "today_close",
            chipState: "closed",
            marketState: "closed",
            source: "daily-provider",
            sourceKind: "primary_daily",
            asOfDate: "2026-06-17",
            asOfTimestamp: null,
            observedAt: "2026-06-17T08:00:00.000Z",
            delaySeconds: null,
            marketTimeZone: "Asia/Taipei",
            quality: "full_bar",
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']") as HTMLButtonElement | null;
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.textContent).toContain("Closed");

    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerover", "touch"));
    });

    expect(document.body.textContent).not.toContain("Basis: Today close");

    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });

    expect(document.body.textContent).toContain("Basis: Today close");
    expect(document.body.textContent).toContain("Market: Closed");

    await act(async () => {
      chip?.click();
    });

    expect(document.body.textContent).toContain("Basis: Today close");
    expect(document.body.textContent).toContain("Market: Closed");
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Basis: Today close");
    expect(document.querySelector("[role='tooltip']")).toBeNull();
  });

  it("shows friendly close-only source details while keeping the chip closed", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "today_close",
            chipState: "closed",
            marketState: "closed",
            source: "yahoo-chart-close",
            sourceKind: "yahoo_chart_close",
            asOfDate: "2026-06-17",
            asOfTimestamp: null,
            observedAt: "2026-06-17T08:00:00.000Z",
            delaySeconds: null,
            marketTimeZone: "Asia/Taipei",
            quality: "close_only",
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']") as HTMLButtonElement | null;
    expect(chip?.textContent).toContain("Closed");

    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });

    const dialogText = document.querySelector("[role='dialog']")?.textContent ?? "";
    expect(dialogText).toContain("Source: Yahoo close");
    expect(dialogText).toContain("Quality: Close only");
    expect(dialogText).toContain("Full daily bar: Pending");
  });

  it("dismisses touch-opened details when tapping outside or tapping the chip again", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "today_close",
            chipState: "closed",
            marketState: "closed",
            source: "daily-provider",
            sourceKind: "primary_daily",
            asOfDate: "2026-06-17",
            asOfTimestamp: null,
            observedAt: "2026-06-17T08:00:00.000Z",
            delaySeconds: null,
            marketTimeZone: "Asia/Taipei",
            quality: "full_bar",
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']") as HTMLButtonElement | null;
    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Basis: Today close");

    await act(async () => {
      document.body.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();

    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Basis: Today close");

    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("keeps details open when a mouse click follows hover-open", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "today_close",
            chipState: "closed",
            marketState: "closed",
            source: "daily-provider",
            sourceKind: "primary_daily",
            asOfDate: "2026-06-17",
            asOfTimestamp: null,
            observedAt: "2026-06-17T08:00:00.000Z",
            delaySeconds: null,
            marketTimeZone: "Asia/Taipei",
            quality: "full_bar",
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']") as HTMLButtonElement | null;
    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerover", "mouse"));
    });
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Basis: Today close");

    await act(async () => {
      chip?.click();
    });

    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Basis: Today close");
    expect(chip?.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens on touch and shows calendar-unknown and intraday-attempt facts", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "previous_close",
            chipState: "open_previous_close",
            marketState: "closed",
            source: "daily-provider",
            sourceKind: "primary_daily",
            asOfDate: "2026-06-19",
            asOfTimestamp: null,
            observedAt: "2026-06-19T01:32:00.000Z",
            delaySeconds: null,
            marketTimeZone: "Asia/Taipei",
            quality: "full_bar",
            marketStateReason: "calendar_unknown",
            calendarStatus: "missing",
            marketLocalDate: "2026-06-19",
            latestAttemptAt: "2026-06-19T01:31:00.000Z",
            latestAttemptOutcome: "skipped",
          } as never}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']") as HTMLButtonElement | null;
    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });

    const dialogText = document.querySelector("[role='dialog']")?.textContent ?? "";
    expect(dialogText).toContain("Calendar: missing");
    expect(dialogText).toContain("Calendar reason: Calendar unknown");
    expect(dialogText).toContain("Market date: 2026-06-19");
    expect(dialogText).toContain("Latest attempt:");
    expect(dialogText).toContain("Latest outcome: Skipped");
  });

  it("renders zh-TW tooltip diagnostics for yahoo symbol, cadence, and activity hint facts", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          dict={zhDict}
          locale="zh-TW"
          testId="price-state-chip"
          priceState={{
            basis: "delayed_intraday",
            chipState: "open_delayed",
            marketState: "open",
            source: "yahoo-chart",
            sourceKind: "intraday_yahoo_chart",
            asOfDate: "2026-06-19",
            asOfTimestamp: "2026-06-19T01:20:00.000Z",
            observedAt: "2026-06-19T01:33:00.000Z",
            delaySeconds: 780,
            marketTimeZone: "Asia/Taipei",
            quality: null,
            yahooSymbol: "2330.TW",
            refreshCadenceMinutes: 5,
            activityPath: "/admin/market-data/TW/activity?source=yahoo_chart",
          } as never}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']") as HTMLButtonElement | null;
    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerdown", "touch"));
    });

    const dialogText = document.querySelector("[role='dialog']")?.textContent ?? "";
    expect(dialogText).toContain("Yahoo 代號: 2330.TW");
    expect(dialogText).toContain("頻率: 5m");
    expect(dialogText).toContain("活動: /admin/market-data/TW/activity?source=yahoo_chart");
  });

  it("groups calendar-unknown warnings by affected market year", async () => {
    act(() => {
      root.render(
        <CalendarUnknownWarnings
          dict={dict}
          rows={[
            {
              marketCode: "TW",
              priceState: {
                basis: "previous_close",
                chipState: "stale",
                marketState: "closed",
                marketStateReason: "calendar_unknown",
                marketLocalDate: "2026-06-19",
                calendarStatus: "calendar_unknown",
                source: "daily-provider",
                sourceKind: "primary_daily",
                asOfDate: "2026-06-18",
                asOfTimestamp: null,
                observedAt: null,
                delaySeconds: null,
                marketTimeZone: "Asia/Taipei",
                quality: "full_bar",
              },
            },
            {
              marketCode: "TW",
              priceState: {
                basis: "previous_close",
                chipState: "stale",
                marketState: "closed",
                marketStateReason: "calendar_unknown",
                marketLocalDate: "2026-06-19",
                calendarStatus: "calendar_unknown",
                source: "daily-provider",
                sourceKind: "primary_daily",
                asOfDate: "2026-06-18",
                asOfTimestamp: null,
                observedAt: null,
                delaySeconds: null,
                marketTimeZone: "Asia/Taipei",
                quality: "full_bar",
              },
            },
          ]}
        />,
      );
    });

    await act(async () => {});

    expect(container.textContent).toContain("Market calendar needs attention");
    expect(container.textContent).toContain("TW market calendar for 2026 is missing. Today in Taipei is 2026-06-19.");
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("uses the bar timestamp for delayed relative labels even when observed recently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T11:00:00.000Z"));

    act(() => {
      root.render(
        <PriceStateChip
          dict={dict}
          locale="en"
          testId="price-state-chip"
          priceState={{
            basis: "delayed_intraday",
            chipState: "open_delayed",
            marketState: "open",
            source: "yahoo-chart",
            sourceKind: "intraday_yahoo_chart",
            asOfDate: "2026-06-17",
            asOfTimestamp: "2026-06-17T10:25:00.000Z",
            observedAt: "2026-06-17T10:59:00.000Z",
            delaySeconds: 2100,
            marketTimeZone: "America/New_York",
            quality: null,
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = document.querySelector("[data-testid='price-state-chip']");
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.textContent).toContain("Delayed 35 minutes");
  });
});
