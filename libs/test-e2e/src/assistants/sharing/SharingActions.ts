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
    // Scope to the open <dialog> element — multiple confirm-dialog elements may be
    // present in the DOM simultaneously (portfolio revoke + anonymous link revoke).
    const dialog = this.page.locator('[data-testid="confirm-dialog"][open]');
    await dialog.waitFor({ state: "visible" });
    await this.mxClick(dialog.getByTestId("confirm-dialog-confirm"));
  }

  // ---------- Section C: Public (anonymous) share links ----------

  @Step()
  async openCreatePublicLinkDialog(): Promise<void> {
    await this.mxClick(this.el.createPublicLinkButton);
    await this.el.createPublicLinkDialog.waitFor({ state: "visible" });
  }

  @Step()
  async selectPublicLinkExpiry(value: "7" | "30" | "90" | "custom", customDays?: string): Promise<void> {
    const target =
      value === "7"
        ? this.el.createPublicLinkOption7Days
        : value === "30"
          ? this.el.createPublicLinkOption30Days
          : value === "90"
            ? this.el.createPublicLinkOption90Days
            : this.el.createPublicLinkOptionCustom;
    await this.mxClick(target);
    if (value === "custom" && customDays !== undefined) {
      await this.el.createPublicLinkCustomInput.fill(customDays);
    }
  }

  @Step()
  async confirmCreatePublicLink(): Promise<void> {
    await this.mxClick(this.el.createPublicLinkConfirm);
  }

  @Step()
  async cancelCreatePublicLink(): Promise<void> {
    await this.mxClick(this.el.createPublicLinkCancel);
  }

  @Step()
  async createPublicLink(expiryValue: "7" | "30" | "90" | "custom", customDays?: string): Promise<void> {
    await this.openCreatePublicLinkDialog();
    await this.selectPublicLinkExpiry(expiryValue, customDays);
    await this.confirmCreatePublicLink();
  }

  @Step()
  async copyPublicLinkUrl(tokenId: string): Promise<void> {
    await this.mxClick(this.page.getByTestId(`sharing-public-link-copy-${tokenId}`));
  }

  @Step()
  async clickRevokePublicLink(tokenId: string): Promise<void> {
    await this.mxClick(this.page.getByTestId(`sharing-public-link-revoke-${tokenId}`));
  }

  @Step()
  async revokePublicLink(tokenId: string): Promise<void> {
    await this.clickRevokePublicLink(tokenId);
    const dialog = this.page.locator('[data-testid="confirm-dialog"][open]');
    await dialog.waitFor({ state: "visible" });
    await this.mxClick(dialog.getByTestId("confirm-dialog-confirm"));
  }
}
