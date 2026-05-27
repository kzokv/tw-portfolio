"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, Check, ExternalLink, ShieldCheck, X } from "lucide-react";
import type { AiConnectorScope, McpOAuthConsentRequestDto } from "@vakwen/shared-types";
import { API_PUBLIC } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import {
  approveMcpOAuthConsent,
  denyMcpOAuthConsent,
  fetchMcpOAuthConsent,
} from "../../features/ai-inbox/service";
import { AI_CONNECTOR_SCOPE_LABELS } from "./scopeLabels";

function scopeEnabledByPolicy(scope: AiConnectorScope, consent: McpOAuthConsentRequestDto): boolean {
  if (scope === "portfolio:mcp_read") return consent.policy.groupToggles.read;
  if (scope.startsWith("transaction_draft:")) return consent.policy.groupToggles.drafts;
  return consent.policy.groupToggles.write;
}

function scopeDefaultsGranted(scope: AiConnectorScope): boolean {
  return scope !== "transaction:write";
}

function currentRequestId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("requestId");
}

function redirectToAuthorizeEndpoint(): void {
  const query = window.location.search.replace(/^\?/, "");
  window.location.href = `${API_PUBLIC}/oauth/authorize${query ? `?${query}` : ""}`;
}

export function ChatGptConnectorAuthorizeClient() {
  const [consent, setConsent] = useState<McpOAuthConsentRequestDto | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<Set<AiConnectorScope>>(new Set());
  const [lifetimeDays, setLifetimeDays] = useState(30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  const load = useCallback(async () => {
    const requestId = currentRequestId();
    if (!requestId) {
      redirectToAuthorizeEndpoint();
      return;
    }
    setError("");
    try {
      const next = await fetchMcpOAuthConsent(requestId);
      setConsent(next);
      setSelectedScopes(new Set(next.scopes.filter((scope) => scopeEnabledByPolicy(scope, next) && scopeDefaultsGranted(scope))));
      setLifetimeDays(Math.min(30, next.policy.maxConnectorLifetimeDays));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connector authorization request could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeRows = useMemo(() => consent?.scopes ?? [], [consent]);
  const enabledScopes = useMemo(
    () => consent?.scopes.filter((scope) => scopeEnabledByPolicy(scope, consent)) ?? [],
    [consent],
  );
  const allScopesDisabled = consent !== null && enabledScopes.length === 0;
  const canApprove = consent !== null && selectedScopes.size > 0 && !allScopesDisabled && busy === null;

  function toggleScope(scope: AiConnectorScope, checked: boolean) {
    setSelectedScopes((current) => {
      const next = new Set(current);
      if (checked) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  async function approve() {
    if (!consent || !canApprove) return;
    setBusy("approve");
    setError("");
    try {
      const result = await approveMcpOAuthConsent(consent.requestId, {
        csrfToken: consent.csrfToken,
        scopes: [...selectedScopes],
        lifetimeDays,
      });
      window.location.href = result.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connector approval failed.");
      setBusy(null);
    }
  }

  async function deny() {
    if (!consent || busy !== null) return;
    setBusy("deny");
    setError("");
    try {
      const result = await denyMcpOAuthConsent(consent.requestId, consent.csrfToken);
      window.location.href = result.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connector denial failed.");
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Connect ChatGPT</h1>
            <p className="text-sm text-slate-600">Authorize ChatGPT to use Vakwen MCP tools for your account.</p>
          </div>
        </div>

        {error ? (
          <Card className="rounded-lg border-rose-200 bg-rose-50" role="alert">
            <div className="space-y-3">
              <p className="text-sm text-rose-700">{error}</p>
              {!consent ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="secondary" onClick={() => void load()}>
                    Retry request
                  </Button>
                  <Button variant="outline" onClick={() => { window.location.href = "https://chatgpt.com/"; }}>
                    Start again in ChatGPT
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {!consent && !error ? (
          <Card className="rounded-lg" role="status" aria-live="polite" aria-busy="true">
            <p className="text-sm text-slate-600">Loading authorization request...</p>
          </Card>
        ) : null}

        {consent ? (
          <Card className="rounded-lg">
            <div className="space-y-6">
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-slate-500">Client</p>
                  <p className="mt-1 font-medium text-slate-900">{consent.clientId}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500">MCP resource</p>
                  <p className="mt-1 select-all break-all font-medium text-slate-900">{consent.resource}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase text-slate-500">Redirect</p>
                  <a
                    href={consent.redirectUri}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 flex items-start gap-2 break-all font-medium text-slate-900 underline decoration-slate-300 underline-offset-2"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {consent.redirectUri}
                  </a>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  <h2 className="text-base font-semibold">Permissions</h2>
                </div>
                {allScopesDisabled ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
                    Admin policy has disabled every requested MCP tool group. Deny this request or ask an admin to re-enable at least one MCP tool group before approving.
                  </div>
                ) : null}
                <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                  {scopeRows.map((scope) => {
                    const policyDisabled = !scopeEnabledByPolicy(scope, consent);
                    const disabled = policyDisabled || busy !== null;
                    return (
                      <label key={scope} className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-sm">
                        <span className={disabled ? "text-slate-400" : "text-slate-800"}>
                          {AI_CONNECTOR_SCOPE_LABELS[scope]}
                          {policyDisabled ? <span className="block text-xs text-slate-500">Disabled by admin policy</span> : null}
                          {scope === "transaction:write" ? (
                            <span className="mt-1 block text-xs text-amber-700">
                              Advanced scope. Off by default and requires fresh auth or re-consent to grant.
                            </span>
                          ) : null}
                        </span>
                        <input
                          type="checkbox"
                          checked={selectedScopes.has(scope)}
                          disabled={disabled}
                          onChange={(event) => toggleScope(scope, event.target.checked)}
                        />
                      </label>
                    );
                  })}
                </div>
                {consent.scopes.includes("transaction:write") ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Posting is an advanced opt-in. Leave it unchecked unless you want ChatGPT to call the guarded
                        `post_transaction_draft_rows` tool after typed or explicit confirmation.
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Connector lifetime
                <input
                  type="number"
                  min={1}
                  max={consent.policy.maxConnectorLifetimeDays}
                  value={lifetimeDays}
                  disabled={busy !== null}
                  onChange={(event) => setLifetimeDays(Math.min(
                    consent.policy.maxConnectorLifetimeDays,
                    Math.max(1, Number(event.target.value) || 1),
                  ))}
                  className="mt-1 block w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>

              {busy ? <p className="sr-only" role="status" aria-live="polite">{busy === "approve" ? "Approving connector request" : "Denying connector request"}</p> : null}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => void deny()} disabled={busy !== null}>
                  <X className="mr-2 h-4 w-4" aria-hidden="true" />
                  Deny
                </Button>
                <Button onClick={() => void approve()} disabled={!canApprove}>
                  <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                  {busy === "approve" ? "Approving..." : "Approve"}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
