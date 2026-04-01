import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseArrange } from "@tw-portfolio/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";

import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

interface SeedInstrument {
  ticker: string;
  name: string | null;
  instrumentType: string | null;
  marketCode: string;
  barsBackfillStatus: string;
}

export class SettingsArrange extends BaseArrange {
  declare protected readonly _instance: SettingsDrawerPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async openFeesTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.tabs.fees);
  }

  @Step()
  async openTickersTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.tabs.tickers);
  }

  @Step()
  async seedInstruments(instruments: SeedInstrument[]): Promise<void> {
    await this.request.post(apiUrl("/__e2e/seed-instruments"), {
      data: { instruments },
      headers: { "x-user-id": this.userId ?? "user-1" },
    });
  }
}
