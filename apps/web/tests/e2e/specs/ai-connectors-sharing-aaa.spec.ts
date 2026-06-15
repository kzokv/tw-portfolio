import type { Locator } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

async function assertToggleChecked(toggle: Locator, label: string): Promise<void> {
  if (!(await toggle.isChecked())) {
    throw new Error(`Expected ${label} to be checked`);
  }
}

test.describe("ai connectors and sharing", () => {
  test("[ai connectors]: settings route renders deployment summary and empty-state", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/settings/ai-connectors");
    await appShell.assert.appIsReady();

    await page.getByTestId("settings-ai-connectors-page").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "AI Connectors" }).waitFor({ state: "visible" });
    await page.getByText("Deployment").waitFor({ state: "visible" });
    await page.getByText("Active connection cap").waitFor({ state: "visible" });
    await page.getByText("No AI connectors are connected.").waitFor({ state: "visible" });
  });

  test("[admin mcp settings]: settings route renders deployment and policy controls", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings?tab=mcp");
    await appShell.assert.appIsReady();

    await page.getByTestId("admin-settings-panel-mcp").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "MCP settings" }).waitFor({ state: "visible" });
    await page.getByText("MCP deployment").waitFor({ state: "visible" });
    await page.getByTestId("admin-settings-panel-mcp")
      .getByText(/^Global AI connector policy\./)
      .waitFor({ state: "visible" });
    await page.getByText("Max active connectors").waitFor({ state: "visible" });
    await page.getByTestId("admin-settings-mcp-oauth-token-secret-row").waitFor({ state: "visible" });
  });

  test("[sharing]: grant dialog → Delegate manager preset checks delegated write capability", async ({
    appShell,
    page,
    sharing,
  }) => {
    await appShell.actions.navigateToRoute("/sharing");
    await appShell.assert.appIsReady();

    await sharing.actions.openGrantDialog();
    await page.getByText("Delegated permissions").waitFor({ state: "visible" });
    await page.getByText("ChatGPT portfolio read").waitFor({ state: "visible" });
    await page.getByText("Manage accounts and fee settings").waitFor({ state: "visible" });
    await page.getByText("Create AI drafts").waitFor({ state: "visible" });
    await page.getByText("Create, edit, and delete transactions").waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Delegate manager" }).click();

    const transactionWriteToggle = page.getByRole("checkbox", {
      name: "Create, edit, and delete transactions",
    });
    await assertToggleChecked(transactionWriteToggle, "Transaction write");
  });
});
