import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@tw-portfolio/test-framework/core";

export interface TSharingElements extends TElementLocatorHelpers {
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
  outboundRow: (rowId: string) => Locator;
  outboundRevokeButton: (rowId: string) => Locator;
  outboundCopyUrlButton: (rowId: string) => Locator;
  outboundReshareButton: (rowId: string) => Locator;
  inboundCard: (shareId: string) => Locator;
  inboundOpenDashboardButton: (shareId: string) => Locator;
  publicLinkRow: (tokenId: string) => Locator;
  publicLinkCopyButton: (tokenId: string) => Locator;
  publicLinkRevokeButton: (tokenId: string) => Locator;
  publicLinkNewBadge: (tokenId: string) => Locator;
  firstPublicLinkRow: Locator;
  firstPublicLinkCopyButton: Locator;
  firstPublicLinkNewBadge: Locator;
  openConfirmDialog: Locator;
  openConfirmButton: Locator;
}

export class SharingPage extends BasePage<TSharingElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
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
      outboundRow: (rowId: string) =>
        this.locate(`sharing-outbound-row-${rowId}`, `Outbound Share Row ${rowId}`),
      outboundRevokeButton: (rowId: string) =>
        this.locate(`sharing-revoke-${rowId}`, `Revoke Share Button ${rowId}`),
      outboundCopyUrlButton: (rowId: string) =>
        this.locate(`sharing-copy-url-${rowId}`, `Copy Share URL Button ${rowId}`),
      outboundReshareButton: (rowId: string) =>
        this.locate(`sharing-reshare-${rowId}`, `Reshare Button ${rowId}`),
      inboundCard: (shareId: string) =>
        this.locate(`sharing-inbound-card-${shareId}`, `Inbound Share Card ${shareId}`),
      inboundOpenDashboardButton: (shareId: string) =>
        this.locate(`sharing-open-dashboard-${shareId}`, `Open Shared Dashboard ${shareId}`),
      publicLinkRow: (tokenId: string) =>
        this.locate(`sharing-public-link-row-${tokenId}`, `Public Link Row ${tokenId}`),
      publicLinkCopyButton: (tokenId: string) =>
        this.locate(`sharing-public-link-copy-${tokenId}`, `Copy Public Link ${tokenId}`),
      publicLinkRevokeButton: (tokenId: string) =>
        this.locate(`sharing-public-link-revoke-${tokenId}`, `Revoke Public Link ${tokenId}`),
      publicLinkNewBadge: (tokenId: string) =>
        this.locate(`sharing-public-link-new-badge-${tokenId}`, `Public Link New Badge ${tokenId}`),
      firstPublicLinkRow: this.withDescription(
        this.scope.locator('[data-testid^="sharing-public-link-row-"]').first(),
        "First Public Link Row",
      ),
      firstPublicLinkCopyButton: this.withDescription(
        this.scope
          .locator('[data-testid^="sharing-public-link-row-"]')
          .first()
          .locator('[data-testid^="sharing-public-link-copy-"]'),
        "First Public Link Copy Button",
      ),
      firstPublicLinkNewBadge: this.withDescription(
        this.scope
          .locator('[data-testid^="sharing-public-link-row-"]')
          .first()
          .locator('[data-testid^="sharing-public-link-new-badge-"]'),
        "First Public Link New Badge",
      ),
      openConfirmDialog: this.withDescription(
        this.scope.locator('[data-testid="confirm-dialog"][open]'),
        "Open Confirm Dialog",
      ),
      openConfirmButton: this.withDescription(
        this.scope.locator('[data-testid="confirm-dialog"][open]').getByTestId("confirm-dialog-confirm"),
        "Open Confirm Dialog Confirm Button",
      ),
    };
  }
}
