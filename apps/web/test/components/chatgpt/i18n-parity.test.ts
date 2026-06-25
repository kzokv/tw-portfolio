import { describe, expect, it } from "vitest";
import { chatGptAccountManagerCopy, chatGptTransactionDraftCopy } from "../../../components/chatgpt/i18n";
import { aiConnectorScopeLabels, chatGptConnectorAuthorizeCopy } from "../../../components/connectors/i18n";
import { aiInboxCopy } from "../../../components/transactions/aiInboxI18n";

function expectSameShape(left: unknown, right: unknown) {
  if (left && typeof left === "object" && right && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const leftKeys = Object.keys(left as Record<string, unknown>).sort();
    const rightKeys = Object.keys(right as Record<string, unknown>).sort();
    expect(rightKeys).toEqual(leftKeys);
    for (const key of leftKeys) {
      expectSameShape(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      );
    }
  }
}

describe("surface i18n parity", () => {
  it("keeps ChatGPT transaction draft copy in parity", () => {
    expectSameShape(chatGptTransactionDraftCopy.en, chatGptTransactionDraftCopy["zh-TW"]);
  });

  it("keeps ChatGPT account manager copy in parity", () => {
    expectSameShape(chatGptAccountManagerCopy.en, chatGptAccountManagerCopy["zh-TW"]);
  });

  it("keeps connector authorize copy and scope labels in parity", () => {
    expectSameShape(chatGptConnectorAuthorizeCopy.en, chatGptConnectorAuthorizeCopy["zh-TW"]);
    expectSameShape(aiConnectorScopeLabels.en, aiConnectorScopeLabels["zh-TW"]);
  });

  it("keeps AI Inbox copy in parity", () => {
    expectSameShape(aiInboxCopy.en, aiInboxCopy["zh-TW"]);
  });
});
