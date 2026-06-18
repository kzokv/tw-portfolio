// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDictionary } from "../../../lib/i18n/types";
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

  it("can render as a popover disclosure for touch and narrow viewports", async () => {
    act(() => {
      root.render(
        <PriceStateChip
          disclosure="popover"
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
      chip?.click();
    });

    expect(document.body.textContent).toContain("Basis: Today close");
    expect(document.body.textContent).toContain("Market: Closed");
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
