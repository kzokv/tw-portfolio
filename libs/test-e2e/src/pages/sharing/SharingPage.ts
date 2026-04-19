import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TSharingElements {
  page: Locator;
  grantButton: Locator;
  outboundSection: Locator;
  inboundSection: Locator;
  inboundEmpty: Locator;
  grantDialog: Locator;
  grantEmailInput: Locator;
  grantContinue: Locator;
  grantConfirm: Locator;
  grantDone: Locator;
  grantInviteUrl: Locator;
  grantCopyUrl: Locator;
  grantError: Locator;
  flashMessage: Locator;
  historyToggle: Locator;
  revokeDialog: Locator;
  revokeConfirm: Locator;
  roleNote: Locator;

  // Section C — public (anonymous) share links
  publicLinksSection: Locator;
  publicLinksEmpty: Locator;
  publicLinksCapBanner: Locator;
  publicLinksFlash: Locator;
  createPublicLinkButton: Locator;
  createPublicLinkDialog: Locator;
  createPublicLinkOption7Days: Locator;
  createPublicLinkOption30Days: Locator;
  createPublicLinkOption90Days: Locator;
  createPublicLinkOptionCustom: Locator;
  createPublicLinkCustomInput: Locator;
  createPublicLinkConfirm: Locator;
  createPublicLinkCancel: Locator;
}

export class SharingPage extends BasePage<TSharingElements> {
  protected initializeElements(): void {
    this._elements = {
      page: this.locate("sharing-page", "Sharing Page"),
      grantButton: this.locate("sharing-grant-button", "Share your portfolio button"),
      outboundSection: this.locate("sharing-outbound-section", "Outbound section"),
      inboundSection: this.locate("sharing-inbound-section", "Inbound section"),
      inboundEmpty: this.locate("sharing-inbound-empty", "Inbound empty state"),
      grantDialog: this.locate("grant-share-dialog", "Grant share dialog"),
      grantEmailInput: this.locate("grant-share-email-input", "Grant share email input"),
      grantContinue: this.locate("grant-share-continue", "Grant share continue button"),
      grantConfirm: this.locate("grant-share-confirm", "Grant share confirm button"),
      grantDone: this.locate("grant-share-done", "Grant share done button"),
      grantInviteUrl: this.locate("grant-share-invite-url", "Grant share invite URL"),
      grantCopyUrl: this.locate("grant-share-copy-url", "Grant share copy URL button"),
      grantError: this.locate("grant-share-error", "Grant share error"),
      flashMessage: this.locate("sharing-flash-message", "Sharing flash message"),
      historyToggle: this.locate("sharing-history-toggle", "Sharing history toggle"),
      revokeDialog: this.locate("sharing-revoke-dialog", "Sharing revoke dialog"),
      revokeConfirm: this.locate("sharing-revoke-confirm", "Sharing revoke confirm button"),
      roleNote: this.locate("sharing-role-note", "Sharing role note"),

      publicLinksSection: this.locate("sharing-public-links-section", "Public links section"),
      publicLinksEmpty: this.locate("sharing-public-links-empty", "Public links empty state"),
      publicLinksCapBanner: this.locate(
        "sharing-public-links-cap-banner",
        "Public links cap banner (20/20)",
      ),
      publicLinksFlash: this.locate("sharing-public-links-flash", "Public links flash"),
      createPublicLinkButton: this.locate(
        "sharing-public-links-create",
        "Create public link button",
      ),
      createPublicLinkDialog: this.locate("create-public-link-dialog", "Create public link dialog"),
      createPublicLinkOption7Days: this.locate(
        "create-public-link-expiry-7",
        "Create public link 7-day option",
      ),
      createPublicLinkOption30Days: this.locate(
        "create-public-link-expiry-30",
        "Create public link 30-day option",
      ),
      createPublicLinkOption90Days: this.locate(
        "create-public-link-expiry-90",
        "Create public link 90-day option",
      ),
      createPublicLinkOptionCustom: this.locate(
        "create-public-link-expiry-custom",
        "Create public link custom option",
      ),
      createPublicLinkCustomInput: this.locate(
        "create-public-link-expiry-custom-input",
        "Create public link custom input",
      ),
      createPublicLinkConfirm: this.locate(
        "create-public-link-submit",
        "Create public link confirm button",
      ),
      createPublicLinkCancel: this.locate(
        "create-public-link-cancel",
        "Create public link cancel button",
      ),
    };
  }
}
