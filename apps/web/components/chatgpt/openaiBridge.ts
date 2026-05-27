"use client";

import type {
  ChatGptTransactionDraftWidgetDto,
  TransactionDraftPostingResultDto,
} from "@vakwen/shared-types";

export interface OpenAiToolCallResult {
  structuredContent?: unknown;
  content?: unknown;
  _meta?: Record<string, unknown>;
}

export interface OpenAiBridge {
  toolInput?: unknown;
  toolOutput?: unknown;
  toolResponseMetadata?: unknown;
  widgetState?: unknown;
  locale?: string;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<OpenAiToolCallResult>;
  openExternal?: (input: { href: string; redirectUrl?: string | false }) => Promise<void> | void;
  setOpenInAppUrl?: (input: { href: string }) => Promise<void> | void;
  setWidgetState?: (state: unknown) => void;
  notifyIntrinsicHeight?: () => void;
}

declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

export interface ChatGptTransactionDraftWidgetViewState {
  confirmText: string;
  editRowId: string | null;
  mode: "import" | "review" | "post";
  selectedRowIds: string[];
}

function maybeWidgetPayload(value: unknown): ChatGptTransactionDraftWidgetDto | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.batch && Array.isArray(candidate.rows)) return value as ChatGptTransactionDraftWidgetDto;
  if (candidate.widget && typeof candidate.widget === "object") {
    return maybeWidgetPayload(candidate.widget);
  }
  return null;
}

function maybePostingResult(value: unknown): TransactionDraftPostingResultDto | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.batchId === "string" && Array.isArray(candidate.postedRowIds)) {
    if (candidate.confirmation && typeof candidate.confirmation === "object") {
      const confirmation = candidate.confirmation as Record<string, unknown>;
      const typedPhraseRequired = typeof confirmation.typedPhraseRequired === "string"
        ? confirmation.typedPhraseRequired
        : null;
      const typedPhraseSatisfied = confirmation.typedPhraseSatisfied === true;
      return {
        batchId: candidate.batchId,
        batchVersion: typeof candidate.batchVersion === "number" ? candidate.batchVersion : 0,
        postedRowIds: candidate.postedRowIds.filter((item): item is string => typeof item === "string"),
        createdTransactionIds: Array.isArray(candidate.createdTransactionIds)
          ? candidate.createdTransactionIds.filter((item): item is string => typeof item === "string")
          : [],
        remainingUnresolvedRowIds: Array.isArray(candidate.remainingUnresolvedRowIds)
          ? candidate.remainingUnresolvedRowIds.filter((item): item is string => typeof item === "string")
          : [],
        requiresTypedConfirmation: typedPhraseRequired !== null && !typedPhraseSatisfied,
        typedConfirmationPhrase: typedPhraseRequired,
        grossValueAmount: typeof confirmation.grossValueTwd === "number" ? confirmation.grossValueTwd : null,
        grossValueCurrency: typeof confirmation.grossValueTwd === "number" ? "TWD" : null,
        deepLinkUrl: typeof candidate.deepLinkUrl === "string" ? candidate.deepLinkUrl : null,
        auditEventIds: Array.isArray(candidate.eventIds)
          ? candidate.eventIds.filter((item): item is string => typeof item === "string")
          : [],
      };
    }
    return value as TransactionDraftPostingResultDto;
  }
  if (candidate.postResult && typeof candidate.postResult === "object") {
    return maybePostingResult(candidate.postResult);
  }
  return null;
}

export function getOpenAiBridge(): OpenAiBridge | null {
  if (typeof window === "undefined") return null;
  return window.openai ?? null;
}

export function readWidgetPayloadFromBridge(): ChatGptTransactionDraftWidgetDto | null {
  const bridge = getOpenAiBridge();
  if (!bridge) return null;
  return (
    maybeWidgetPayload(bridge.toolResponseMetadata)
    ?? maybeWidgetPayload(bridge.toolOutput)
    ?? maybeWidgetPayload(bridge.widgetState)
  );
}

export function readWidgetViewStateFromBridge(): ChatGptTransactionDraftWidgetViewState | null {
  const bridge = getOpenAiBridge();
  if (!bridge?.widgetState || typeof bridge.widgetState !== "object") return null;
  const value = bridge.widgetState as Record<string, unknown>;
  return {
    confirmText: typeof value.confirmText === "string" ? value.confirmText : "",
    editRowId: typeof value.editRowId === "string" ? value.editRowId : null,
    mode: value.mode === "import" || value.mode === "post" ? value.mode : "review",
    selectedRowIds: Array.isArray(value.selectedRowIds)
      ? value.selectedRowIds.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function persistWidgetViewState(next: ChatGptTransactionDraftWidgetViewState): void {
  getOpenAiBridge()?.setWidgetState?.(next);
}

export function extractToolPayload(result: OpenAiToolCallResult | null | undefined): {
  postingResult: TransactionDraftPostingResultDto | null;
  widget: ChatGptTransactionDraftWidgetDto | null;
} {
  return {
    widget: maybeWidgetPayload(result?._meta) ?? maybeWidgetPayload(result?.structuredContent),
    postingResult: maybePostingResult(result?._meta) ?? maybePostingResult(result?.structuredContent),
  };
}
