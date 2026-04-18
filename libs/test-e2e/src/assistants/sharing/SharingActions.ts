import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { SharingPage } from "../../pages/sharing/SharingPage.js";

export class SharingActions extends AppBaseActions {
  declare protected readonly _instance: SharingPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToSharing(): Promise<void> {
    await this.mxNavigateToRoute("/sharing", TestEnv.appBaseUrl);
  }

  @Step()
  async openGrantDialog(): Promise<void> {
    await this.mxClick(this.el.grantButton);
    await this.el.grantDialog.waitFor({ state: "visible" });
  }

  @Step()
  async enterGrantEmail(email: string): Promise<void> {
    await this.el.grantEmailInput.fill(email);
  }

  @Step()
  async clickGrantContinue(): Promise<void> {
    await this.mxClick(this.el.grantContinue);
  }

  @Step()
  async clickGrantConfirm(): Promise<void> {
    await this.mxClick(this.el.grantConfirm);
  }

  @Step()
  async clickGrantDone(): Promise<void> {
    await this.mxClick(this.el.grantDone);
  }

  @Step()
  async clickCopyInviteUrl(): Promise<void> {
    await this.mxClick(this.el.grantCopyUrl);
  }

  @Step()
  async toggleHistory(): Promise<void> {
    await this.mxClick(this.el.historyToggle);
  }

  @Step()
  async clickRevokeOnRow(rowId: string): Promise<void> {
    await this.mxClick(this.page.getByTestId(`sharing-revoke-${rowId}`));
  }

  @Step()
  async clickCopyUrlOnRow(rowId: string): Promise<void> {
    await this.mxClick(this.page.getByTestId(`sharing-copy-url-${rowId}`));
  }

  @Step()
  async clickReshareOnRow(rowId: string): Promise<void> {
    await this.mxClick(this.page.getByTestId(`sharing-reshare-${rowId}`));
  }

  @Step()
  async confirmRevoke(): Promise<void> {
    const dialog = this.page.getByTestId("confirm-dialog");
    await dialog.waitFor({ state: "visible" });
    await this.mxClick(this.page.getByTestId("confirm-dialog-confirm"));
  }
}
