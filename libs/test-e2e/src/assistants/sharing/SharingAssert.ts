import { expect, request as apiRequest } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";
import type { SharingPage } from "../../pages/sharing/SharingPage.js";

export class SharingAssert extends BaseAssert {
  declare protected readonly _instance: SharingPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async pageIsVisible(): Promise<void> {
    await expect(this.el.page).toBeVisible();
  }

  @Step()
  async grantButtonIsVisible(): Promise<void> {
    await expect(this.el.grantButton).toBeVisible();
  }

  @Step()
  async grantButtonIsHidden(): Promise<void> {
    await expect(this.el.grantButton).toBeHidden();
  }

  @Step()
  async outboundSectionIsVisible(): Promise<void> {
    await expect(this.el.outboundSection).toBeVisible();
  }

  @Step()
  async outboundSectionIsHidden(): Promise<void> {
    await expect(this.el.outboundSection).toBeHidden();
  }

  @Step()
  async inboundSectionIsVisible(): Promise<void> {
    await expect(this.el.inboundSection).toBeVisible();
  }

  @Step()
  async inboundEmptyIsVisible(): Promise<void> {
    await expect(this.el.inboundEmpty).toBeVisible();
  }

  @Step()
  async grantDialogIsVisible(): Promise<void> {
    await expect(this.el.grantDialog).toBeVisible();
  }

  @Step()
  async grantDialogIsHidden(): Promise<void> {
    await expect(this.el.grantDialog).toBeHidden();
  }

  @Step()
  async grantEmailInputIsVisible(): Promise<void> {
    await expect(this.el.grantEmailInput).toBeVisible();
  }

  @Step()
  async grantConfirmIsVisible(): Promise<void> {
    await expect(this.el.grantConfirm).toBeVisible();
  }

  @Step()
  async grantInviteUrlContains(substring: string): Promise<void> {
    await expect(this.el.grantInviteUrl).toHaveValue(new RegExp(substring.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  @Step()
  async grantInviteUrlIsVisible(): Promise<void> {
    await expect(this.el.grantInviteUrl).toBeVisible();
  }

  @Step()
  async flashSuccessContains(text: string): Promise<void> {
    await expect(this.el.flashMessage).toBeVisible();
    await expect(this.el.flashMessage).toContainText(text);
  }

  @Step()
  async outboundRowVisibleWithEmail(rowId: string, email: string): Promise<void> {
    const row = this.page.getByTestId(`sharing-outbound-row-${rowId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(email);
  }

  @Step()
  async outboundRowHidden(rowId: string): Promise<void> {
    await expect(this.page.getByTestId(`sharing-outbound-row-${rowId}`)).toBeHidden();
  }

  @Step()
  async inboundCardVisible(shareId: string): Promise<void> {
    await expect(this.page.getByTestId(`sharing-inbound-card-${shareId}`)).toBeVisible();
  }

  @Step()
  async inboundCardContainsOwnerEmail(email: string): Promise<void> {
    await expect(this.el.inboundSection).toContainText(email);
  }

  @Step()
  async roleNoteIsVisible(): Promise<void> {
    await expect(this.el.roleNote).toBeVisible();
  }

  @Step()
  async statusBadgeOnRow(rowId: string, label: string): Promise<void> {
    const row = this.page.getByTestId(`sharing-outbound-row-${rowId}`);
    await expect(row).toContainText(label);
  }

  /**
   * Verifies that the grantee's persisted notification inbox contains an entry
   * with the expected title + `source = "sharing"`. Uses dev_bypass x-user-id
   * impersonation to fetch the grantee's /notifications.
   *
   * Creates a fresh APIRequestContext so the test's shared cookie jar (which
   * may hold session cookies minted by prior seed calls) cannot override the
   * explicit `x-user-id` header in the API's hydrateAuthContext flow.
   */
  @Step()
  async granteeReceivedNotification(
    granteeUserId: string,
    expectedTitle: string,
  ): Promise<void> {
    const ctx = await apiRequest.newContext();
    try {
      const response = await ctx.get(new URL("/notifications", TestEnv.apiBaseUrl).href, {
        headers: { "x-user-id": granteeUserId },
      });
      expect(response.ok(), `GET /notifications should succeed (got ${response.status()})`).toBe(true);
      const body = (await response.json()) as {
        notifications: Array<{ title: string; source: string }>;
      };
      const match = body.notifications.find((n) => n.title === expectedTitle && n.source === "sharing");
      expect(match, `grantee notification with title "${expectedTitle}"`).toBeDefined();
    } finally {
      await ctx.dispose();
    }
  }
}
