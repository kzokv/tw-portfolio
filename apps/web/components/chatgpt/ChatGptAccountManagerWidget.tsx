"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Plus, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { formatAccountOption } from "../../features/cash-ledger/utils/accountOptions";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { extractToolPayload, getOpenAiBridge } from "./openaiBridge";
import type { ChatGptAccountManagerWidgetPayload, ChatGptAccountManagerWidgetAccount } from "./chatGptWidgetTypes";
import { readAccountManagerPayload } from "./chatGptWidgetTypes";

interface ChatGptAccountManagerWidgetProps {
  fallbackData?: ChatGptAccountManagerWidgetPayload | null;
}

interface AccountDraft {
  name: string;
  defaultCurrency: "TWD" | "USD" | "AUD" | "KRW";
  accountType: "broker" | "bank" | "wallet";
}

const ACCOUNT_TYPE_LABELS = {
  accountTypeBroker: "Broker",
  accountTypeBank: "Bank",
  accountTypeWallet: "Wallet",
};

const EMPTY_DRAFT: AccountDraft = {
  name: "",
  defaultCurrency: "TWD",
  accountType: "broker",
};

function accountSummary(account: ChatGptAccountManagerWidgetAccount): string {
  return formatAccountOption(account, ACCOUNT_TYPE_LABELS);
}

export function ChatGptAccountManagerWidget({
  fallbackData = null,
}: ChatGptAccountManagerWidgetProps) {
  const bridge = getOpenAiBridge();
  const [data, setData] = useState<ChatGptAccountManagerWidgetPayload | null>(
    readAccountManagerPayload(bridge?.toolResponseMetadata) ?? readAccountManagerPayload(bridge?.toolOutput) ?? fallbackData,
  );
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    if (data || !fallbackData) return;
    setData(fallbackData);
  }, [data, fallbackData]);

  const editingAccount = useMemo(
    () => data?.activeAccounts.find((account) => account.id === editingId) ?? null,
    [data?.activeAccounts, editingId],
  );

  useEffect(() => {
    if (!editingAccount) return;
    setDraft({
      name: editingAccount.name,
      defaultCurrency: editingAccount.defaultCurrency,
      accountType: editingAccount.accountType,
    });
  }, [editingAccount]);

  async function callTool(toolName: string | null, args: Record<string, unknown>, successMessage: string) {
    if (!bridge?.callTool || !toolName) return;
    setBusyAction(toolName);
    setError("");
    setMessage("");
    try {
      const result = await bridge.callTool(toolName, args);
      const payload = extractToolPayload(result);
      if (payload.accountManager) {
        setData(payload.accountManager);
      }
      setMessage(successMessage);
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : "Account action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  function resetComposer() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-50 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Card className="border-slate-800 bg-slate-900/95 text-slate-50">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-sky-300" aria-hidden="true" />
              <div>
                <h1 className="text-lg font-semibold text-white">Vakwen account manager</h1>
                <p className="mt-1 text-sm text-slate-300">Waiting for the MCP Apps bridge to provide account state.</p>
              </div>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_28%),linear-gradient(180deg,#0f172a_0%,#111827_38%,#f8fafc_38%,#f8fafc_100%)] px-4 py-5 text-slate-950 sm:px-6" data-testid="chatgpt-account-manager-widget">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[28px] border border-white/10 bg-slate-950/90 px-5 py-5 text-white shadow-2xl shadow-slate-950/35 backdrop-blur sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-teal-100">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                account:manage scope
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{data.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300 sm:text-base">{data.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void callTool(data.tools.refresh, {}, "Account manager refreshed.")}
                disabled={busyAction !== null || !data.tools.refresh}
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Refresh
              </Button>
            </div>
          </div>
          {data.permissions.requiresManageReconsent ? (
            <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              Reconnect in ChatGPT and grant `account:manage` before this widget can create or change accounts.
            </div>
          ) : null}
        </section>

        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{message}</div> : null}
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div> : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.10)]">
            <header className="border-b border-slate-200 bg-slate-50/85 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Accounts</h2>
                  <p className="text-sm text-slate-600">Visible names are what ChatGPT shows to users; IDs stay hidden for routing and tool calls.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                  <span>{data.activeAccounts.length} active</span>
                  <span>{data.deletedAccounts.length} deleted</span>
                </div>
              </div>
            </header>
            <div className="grid gap-0 divide-y divide-slate-200">
              {data.activeAccounts.map((account) => (
                <div key={account.id} className="flex flex-col gap-4 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-base font-semibold text-slate-950">{account.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{accountSummary(account)}</p>
                    <p className="mt-1 text-xs text-slate-500">{account.feeProfileName ?? "No fee profile linked"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingId(account.id)}
                      disabled={busyAction !== null || !data.permissions.canEdit}
                      data-testid={`chatgpt-account-edit-${account.id}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void callTool(data.tools.deleteAccount, { accountId: account.id }, "Account archived.")}
                      disabled={busyAction !== null || !data.permissions.canDelete}
                      data-testid={`chatgpt-account-archive-${account.id}`}
                    >
                      <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                      Archive
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {data.deletedAccounts.length > 0 ? (
              <div className="border-t border-slate-200 bg-slate-50/65 px-5 py-4 sm:px-6">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Recently deleted</h3>
                <div className="mt-3 grid gap-3">
                  {data.deletedAccounts.map((account) => (
                    <div key={account.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{account.name}</p>
                        <p className="text-sm text-slate-600">{accountSummary(account)}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void callTool(data.tools.restoreAccount, { accountId: account.id }, "Account restored.")}
                        disabled={busyAction !== null || !data.permissions.canRestore}
                        data-testid={`chatgpt-account-restore-${account.id}`}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <aside className="space-y-5">
            <Card className="rounded-3xl border-slate-200 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{editingId ? "Edit account" : "Add account"}</h2>
                  <p className="mt-1 text-sm text-slate-600">Currency is fixed after creation in this MCP flow, so editing only changes the visible name.</p>
                </div>
                {editingId ? (
                  <Button variant="ghost" size="sm" onClick={resetComposer}>Cancel</Button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Account name
                  <input
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    value={draft.name}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Currency
                  <select
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 disabled:bg-slate-100"
                    onChange={(event) => setDraft((current) => ({ ...current, defaultCurrency: event.target.value as AccountDraft["defaultCurrency"] }))}
                    value={draft.defaultCurrency}
                    disabled={editingId !== null}
                  >
                    {["TWD", "USD", "AUD", "KRW"].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Account type
                  <select
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 disabled:bg-slate-100"
                    onChange={(event) => setDraft((current) => ({ ...current, accountType: event.target.value as AccountDraft["accountType"] }))}
                    value={draft.accountType}
                    disabled={editingId !== null}
                  >
                    <option value="broker">Broker</option>
                    <option value="bank">Bank</option>
                    <option value="wallet">Wallet</option>
                  </select>
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {editingId ? (
                  <Button
                    onClick={() => void callTool(data.tools.updateAccount, { accountId: editingId, name: draft.name.trim() }, "Account updated.")}
                    disabled={busyAction !== null || !draft.name.trim() || !data.permissions.canEdit}
                  >
                    Save changes
                  </Button>
                ) : (
                  <Button
                    onClick={() => void callTool(data.tools.createAccount, {
                      name: draft.name.trim(),
                      defaultCurrency: draft.defaultCurrency,
                      accountType: draft.accountType,
                    }, "Account created.")}
                    disabled={busyAction !== null || !draft.name.trim() || !data.permissions.canCreate}
                  >
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add account
                  </Button>
                )}
              </div>
            </Card>

            <Card className="rounded-3xl border-slate-200 px-5 py-5">
              <h3 className="text-base font-semibold text-slate-950">Scope guardrails</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                <li>Account names are user-facing labels; IDs remain internal.</li>
                <li>Currency and account type are fixed once created in this pass.</li>
                <li>Soft delete keeps historical transactions addressable.</li>
              </ul>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}
