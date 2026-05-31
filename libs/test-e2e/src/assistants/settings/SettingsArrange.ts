import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";

import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

interface SeedInstrument {
  ticker: string;
  name: string | null;
  instrumentType: string | null;
  marketCode: string;
  barsBackfillStatus: string;
  lastRepairAt?: string;
  industryCategoryRaw?: string | null;
  /**
   * KZO-196 — optional GICS industry-group label seeded onto AU rows for
   * sector-filter E2E coverage. Backend-side `/__e2e/seed-instruments`
   * Zod schema is extended in the same wave to accept this field.
   */
  gicsIndustryGroup?: string | null;
}

export class SettingsArrange extends BaseArrange {
  declare protected readonly _instance: SettingsDrawerPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async openAccountsTab(): Promise<void> {
    // Phase 3d S9 — drawer-tab click replaced by nav-item click which
    // triggers a Next.js full-page navigation to /settings/accounts.
    await this.uiActions.click.perform(this.el.tabs.accounts);
    await this.el.section("accounts").waitFor({ state: "visible", timeout: 10_000 });
  }

  @Step()
  async openTickersTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.tabs.tickers);
    await this.el.section("tickers").waitFor({ state: "visible", timeout: 10_000 });
  }

  @Step()
  async seedInstruments(instruments: SeedInstrument[]): Promise<void> {
    const response = await this.request.post(apiUrl("/__e2e/seed-instruments"), {
      data: { instruments },
      headers: { "x-user-id": this.userId ?? "user-1" },
    });
    if (!response.ok()) throw new Error(`seedInstruments failed: ${response.status()} ${await response.text()}`);
  }

  @Step()
  async setManualMonitoredTickers(
    tickers: Array<string | { ticker: string; marketCode?: string }>,
  ): Promise<void> {
    await this.request.put(apiUrl("/monitored-tickers"), {
      data: {
        tickers: tickers.map((item) =>
          typeof item === "string"
            ? { ticker: item, marketCode: "TW" }
            : { ticker: item.ticker, marketCode: item.marketCode ?? "TW" },
        ),
      },
      headers: { "x-user-id": this.userId ?? "user-1" },
    });
  }

  @Step()
  async publishRepairEvent(eventType: "repair_started" | "repair_complete" | "repair_failed", data: Record<string, unknown>): Promise<void> {
    await this.request.post(apiUrl("/__test/publish-event"), {
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId ?? "user-1",
      },
      data: { type: eventType, data },
    });
  }

  /**
   * KZO-188: inject a one-time search error into the AU mock provider.
   * The next `searchInstruments` call will throw, simulating a degraded upstream.
   * Auto-clears after one fire (via `_setNextSearchError` on the mock provider).
   *
   * Uses `assertE2ESeedEnabled()` guard (additive, not destructive — works in
   * both dev_bypass and oauth modes per `.claude/rules/e2e-seed-vs-reset-guards.md`).
   */
  @Step()
  async injectSearchError(): Promise<void> {
    const response = await this.request.post(apiUrl("/__e2e/inject-search-error"));
    if (!response.ok()) {
      throw new Error(
        `/__e2e/inject-search-error failed: ${response.status()} ${await response.text()}`,
      );
    }
  }
}
