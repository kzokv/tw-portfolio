import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { FxTransferPage } from "../../pages/fx-transfer/FxTransferPage.js";

export class FxTransferActions extends AppBaseActions {
  declare protected readonly _instance: FxTransferPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async openCreateDialog(): Promise<void> {
    await this.uiActions.click.perform(this.el.newTransferButton);
  }

  @Step()
  async selectFromAccount(accountId: string): Promise<void> {
    await this.uiActions.select.perform(this.el.fromAccountSelect, accountId);
  }

  @Step()
  async selectToAccount(accountId: string): Promise<void> {
    await this.uiActions.select.perform(this.el.toAccountSelect, accountId);
  }

  @Step()
  async fillFromAmount(amount: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.fromAmountInput, amount);
  }

  @Step()
  async fillToAmount(amount: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.toAmountInput, amount);
  }

  @Step()
  async fillRate(rate: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.rateInput, rate);
  }

  @Step()
  async fillEntryDate(date: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.entryDateInput, date);
  }

  @Step()
  async submit(): Promise<void> {
    await this.uiActions.click.perform(this.el.submitButton);
  }
}
