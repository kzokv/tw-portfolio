"use client";

import { useEffect, useMemo } from "react";
import type {
  ChatGptTransactionDraftWidgetDto,
  LocaleCode,
  TransactionDraftPostingResultDto,
} from "@vakwen/shared-types";
import { ChatGptTransactionDraftWidget } from "./ChatGptTransactionDraftWidget";
import type { OpenAiBridge, OpenAiToolCallResult } from "./openaiBridge";
import { readAccountOptions, readPostingPreview } from "./chatGptWidgetTypes";
import { buildMockTransactionDraftWidgetData } from "./mockTransactionDraftWidgetData";
import { normalizeChatGptLocale } from "./i18n";

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

export function ChatGptTransactionDraftWidgetHarnessClient({ locale = "en" }: { locale?: LocaleCode | string }) {
  const resolvedLocale = normalizeChatGptLocale(locale);
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
      locale: resolvedLocale,
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
            const updates = Array.isArray(args.rows)
              ? args.rows.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
              : [];
            current.rows = current.rows.map((row) => {
              const update = updates.find((item) => item?.rowId === row.id);
              if (!update) return row;
              const patch = update.patch && typeof update.patch === "object"
                ? update.patch as Record<string, unknown>
                : {};
              return {
                ...row,
                accountId: typeof patch.accountName === "string"
                  ? readAccountOptions(current).find((account) => account.name === patch.accountName)?.id ?? row.accountId
                  : typeof patch.accountId === "string"
                    ? patch.accountId
                    : row.accountId,
                accountName: typeof patch.accountName === "string"
                  ? patch.accountName
                  : typeof patch.accountId === "string"
                    ? readAccountOptions(current).find((account) => account.id === patch.accountId)?.name ?? row.accountName
                  : row.accountName,
                marketCode: patch.marketCode === "TW" || patch.marketCode === "US" || patch.marketCode === "AU"
                  ? patch.marketCode
                  : row.marketCode,
                commissionAmount: typeof patch.commissionAmount === "number" ? patch.commissionAmount : row.commissionAmount,
                note: typeof patch.note === "string" ? patch.note : row.note,
                quantity: typeof patch.quantity === "number" ? patch.quantity : row.quantity,
                sourceSnippet: typeof patch.sourceSnippet === "string" ? patch.sourceSnippet : row.sourceSnippet,
                taxAmount: typeof patch.taxAmount === "number" ? patch.taxAmount : row.taxAmount,
                unitPrice: typeof patch.unitPrice === "number" ? patch.unitPrice : row.unitPrice,
                version: row.version + 1,
              };
            });
            const postingPreview = readPostingPreview(current);
            if (postingPreview) {
              postingPreview.rows = postingPreview.rows.map((row) => {
                const update = updates.find((item) => item?.rowId === row.rowId);
                if (!update) return row;
                const patch = update.patch && typeof update.patch === "object"
                  ? update.patch as Record<string, unknown>
                  : {};
                return {
                  ...row,
                  accountId: typeof patch.accountName === "string"
                    ? readAccountOptions(current).find((account) => account.name === patch.accountName)?.id ?? row.accountId
                    : typeof patch.accountId === "string"
                      ? patch.accountId
                      : row.accountId,
                  accountName: typeof patch.accountName === "string"
                    ? patch.accountName
                    : typeof patch.accountId === "string"
                      ? readAccountOptions(current).find((account) => account.id === patch.accountId)?.name ?? row.accountName
                    : row.accountName,
                  commissionAmount: typeof patch.commissionAmount === "number" ? patch.commissionAmount : row.commissionAmount,
                  taxAmount: typeof patch.taxAmount === "number" ? patch.taxAmount : row.taxAmount,
                  warnings: typeof patch.commissionAmount === "number" && patch.commissionAmount === 0
                    ? ["Manual zero commission differs from calculated fee"]
                    : row.warnings,
                };
              });
              Object.assign(current, { postingPreview });
            }
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
  }, [resolvedLocale, widget]);

  return <ChatGptTransactionDraftWidget fallbackData={widget} locale={resolvedLocale} />;
}
