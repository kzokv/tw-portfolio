import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

const ONE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

export class AppShellArrange extends BaseArrange {
  @Step()
  async stubAvatarImage(pathPattern = "**/profile-e2e.jpg"): Promise<void> {
    await this.page.route(pathPattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from(ONE_PIXEL_GIF_BASE64, "base64"),
      }));
  }
}
