"use client";

import { useEffect, useMemo } from "react";
import type {
  ChatGptTransactionDraftWidgetDto,
  TransactionDraftPostingResultDto,
} from "@vakwen/shared-types";
import { ChatGptTransactionDraftWidget } from "./ChatGptTransactionDraftWidget";
import type { OpenAiBridge, OpenAiToolCallResult } from "./openaiBridge";
import { buildMockTransactionDraftWidgetData } from "./mockTransactionDraftWidgetData";

function cloneWidget(widget: ChatGptTransactionDraftWidgetDto): ChatGptTransactionDraftWidgetDto {
  return JSON.parse(JSON.stringify(widget)) as ChatGptTransactionDraftWidgetDto;
}

function buildPostingResult(widget: ChatGptTransactionDraftWidgetDto, rowIds: string[]): TransactionDraftPostingResultDto {
  return {
    batchId: widget.batch.id,
    batchVersion: widget.batch.version,
    postedRowIds: rowIds,
    createdTransactionIds: rowIds.map((rowId) => `txn-${rowId}`),
    remainingUnresolvedRowIds: widget.rows.filter((row) => row.state !== "confirmed" && !rowIds.includes(row.id)).map((row) => row.id),
    requiresTypedConfirmation: rowIds.length >= 3,
    typedConfirmationPhrase: `POST ${rowIds.length} TRADES`,
    grossValueAmount: 1_382_000,
    grossValueCurrency: "TWD",
    deepLinkUrl: widget.deepLinkUrl,
    auditEventIds: rowIds.map((rowId) => `audit-${rowId}`),
  };
}

export function ChatGptTransactionDraftWidgetHarnessClient() {
  const widget = useMemo(() => buildMockTransactionDraftWidgetData(), []);

  useEffect(() => {
    let current = cloneWidget(widget);
    const bridge: OpenAiBridge = {
      toolOutput: current,
      toolResponseMetadata: { widget: current },
      widgetState: {
        confirmText: "",
        editRowId: null,
        mode: current.mode,
        selectedRowIds: current.selectedRowIds,
      },
      locale: "en",
      setWidgetState(state) {
        bridge.widgetState = state;
      },
      notifyIntrinsicHeight() {
        window.dispatchEvent(new CustomEvent("vakwen:harness-height"));
      },
      async openExternal({ href }) {
        (window as Window & { __vakwenHarnessLastExternalHref?: string }).__vakwenHarnessLastExternalHref = href;
      },
      async setOpenInAppUrl({ href }) {
        (window as Window & { __vakwenHarnessOpenInAppHref?: string }).__vakwenHarnessOpenInAppHref = href;
      },
      async callTool(name, args): Promise<OpenAiToolCallResult> {
        current = cloneWidget(current);
        switch (name) {
          case "update_transaction_draft_rows": {
            const rowId = String(args.rowId);
            const patch = (args.patch ?? {}) as Record<string, unknown>;
            current.rows = current.rows.map((row) => row.id !== rowId
              ? row
              : {
                  ...row,
                  accountId: typeof patch.accountId === "string" ? patch.accountId : row.accountId,
                  marketCode: patch.marketCode === "TW" || patch.marketCode === "US" || patch.marketCode === "AU"
                    ? patch.marketCode
                    : row.marketCode,
                  note: typeof patch.note === "string" ? patch.note : row.note,
                  quantity: typeof patch.quantity === "number" ? patch.quantity : row.quantity,
                  sourceSnippet: typeof patch.sourceSnippet === "string" ? patch.sourceSnippet : row.sourceSnippet,
                  unitPrice: typeof patch.unitPrice === "number" ? patch.unitPrice : row.unitPrice,
                  version: row.version + 1,
                });
            break;
          }
          case "exclude_transaction_draft_rows":
          case "reinclude_transaction_draft_rows":
          case "reject_transaction_draft_rows": {
            const rowIds = Array.isArray(args.rowIds) ? args.rowIds.map(String) : [];
            const nextState = name === "exclude_transaction_draft_rows"
              ? "excluded"
              : name === "reinclude_transaction_draft_rows"
                ? "ready"
                : "rejected";
            current.rows = current.rows.map((row) => rowIds.includes(row.id) ? { ...row, state: nextState, version: row.version + 1 } : row);
            break;
          }
          case "archive_transaction_draft_batch": {
            current.batch.status = "archived";
            current.batch.version += 1;
            break;
          }
          case "delete_unconfirmed_transaction_draft_batch": {
            current.batch.status = "deleted";
            current.batch.version += 1;
            break;
          }
          case "post_transaction_draft_rows": {
            const rowIds = Array.isArray(args.rowIds) ? args.rowIds.map(String) : [];
            current.rows = current.rows.map((row) => rowIds.includes(row.id)
              ? { ...row, state: "confirmed", confirmedAt: "2026-05-27T10:22:00.000Z", confirmedTradeEventId: `txn-${row.id}`, version: row.version + 1 }
              : row);
            current.batch.version += 1;
            current.postingResult = buildPostingResult(current, rowIds);
            break;
          }
          default:
            break;
        }

        bridge.toolOutput = current;
        bridge.toolResponseMetadata = { widget: current, postResult: current.postingResult };
        return {
          structuredContent: current,
          _meta: { widget: current, postResult: current.postingResult },
        };
      },
    };

    window.openai = bridge;
    return () => {
      delete window.openai;
    };
  }, [widget]);

  return <ChatGptTransactionDraftWidget fallbackData={widget} />;
}
