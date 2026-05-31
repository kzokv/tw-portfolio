"use client";

import { useEffect, useMemo } from "react";
import { ChatGptAccountManagerWidget } from "./ChatGptAccountManagerWidget";
import { buildMockAccountManagerWidgetData } from "./mockAccountManagerWidgetData";
import type { OpenAiBridge, OpenAiToolCallResult } from "./openaiBridge";
import type { ChatGptAccountManagerWidgetPayload } from "./chatGptWidgetTypes";

function clonePayload(payload: ChatGptAccountManagerWidgetPayload): ChatGptAccountManagerWidgetPayload {
  return JSON.parse(JSON.stringify(payload)) as ChatGptAccountManagerWidgetPayload;
}

export function ChatGptAccountManagerWidgetHarnessClient() {
  const widget = useMemo(() => buildMockAccountManagerWidgetData(), []);

  useEffect(() => {
    let current = clonePayload(widget);
    const bridge: OpenAiBridge = {
      toolOutput: current,
      toolResponseMetadata: current,
      async callTool(name, args): Promise<OpenAiToolCallResult> {
        current = clonePayload(current);
        switch (name) {
          case "create_account": {
            current.activeAccounts.unshift({
              id: `acct-${current.activeAccounts.length + current.deletedAccounts.length + 1}`,
              name: String(args.name ?? "New account"),
              defaultCurrency: String(args.defaultCurrency ?? "TWD") as ChatGptAccountManagerWidgetPayload["activeAccounts"][number]["defaultCurrency"],
              accountType: String(args.accountType ?? "broker") as ChatGptAccountManagerWidgetPayload["activeAccounts"][number]["accountType"],
              feeProfileName: "Unassigned",
              status: "active",
            });
            break;
          }
          case "update_account": {
            current.activeAccounts = current.activeAccounts.map((account) => account.id === args.accountId
              ? { ...account, name: String(args.name ?? account.name) }
              : account);
            break;
          }
          case "soft_delete_account": {
            const target = current.activeAccounts.find((account) => account.id === args.accountId);
            current.activeAccounts = current.activeAccounts.filter((account) => account.id !== args.accountId);
            if (target) {
              current.deletedAccounts.unshift({ ...target, status: "deleted", deletedAt: "2026-05-31T11:00:00.000Z" });
            }
            break;
          }
          case "restore_account": {
            const target = current.deletedAccounts.find((account) => account.id === args.accountId);
            current.deletedAccounts = current.deletedAccounts.filter((account) => account.id !== args.accountId);
            if (target) {
              current.activeAccounts.unshift({ ...target, status: "active", deletedAt: null });
            }
            break;
          }
          default:
            break;
        }
        bridge.toolOutput = current;
        bridge.toolResponseMetadata = current;
        return {
          structuredContent: current,
          _meta: { widget: current },
        };
      },
    };

    window.openai = bridge;
    return () => {
      delete window.openai;
    };
  }, [widget]);

  return <ChatGptAccountManagerWidget fallbackData={widget} />;
}
