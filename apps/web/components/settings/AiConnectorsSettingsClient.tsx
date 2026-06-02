"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import type { AiConnectorAccessLogDto, AiConnectorConnectionDto, AiConnectorScope } from "@vakwen/shared-types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import {
  fetchAiConnectorLogs,
  fetchAiConnectorSummary,
  revokeAiConnector,
  updateAiConnector,
  type AiConnectorSummaryResponse,
} from "../../features/ai-inbox/service";
import { AI_CONNECTOR_SCOPE_LABELS } from "../connectors/scopeLabels";

const GROUPED_SCOPES: Array<{ title: string; scopes: AiConnectorScope[] }> = [
  { title: "Read", scopes: ["portfolio:mcp_read"] },
  { title: "Accounts", scopes: ["account:manage"] },
  { title: "Drafts", scopes: ["transaction_draft:create", "transaction_draft:edit", "transaction_draft:archive", "transaction_draft:delete"] },
  { title: "Posting", scopes: ["transaction:write"] },
];

const CHATGPT_RECONNECT_URL = "https://chatgpt.com/";

function statusClassName(status: AiConnectorConnectionDto["status"]): string {
  if (status === "pending") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "expired") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function policyValue(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined) return "-";
  return `${value}${suffix}`;
}

function scopeNeedsReconnect(connection: AiConnectorConnectionDto, scope: AiConnectorScope): boolean {
  return (scope === "transaction:write" || scope === "account:manage")
    && connection.provider === "chatgpt"
    && !connection.scopes.includes(scope);
}

function reconnectCopy(scope: AiConnectorScope): string {
  if (scope === "transaction:write") {
    return "Advanced scope. Reconnect or re-consent in ChatGPT to enable posting.";
  }
  return "Reconnect or re-consent in ChatGPT to enable account management tools.";
}

export function AiConnectorsSettingsClient() {
  const [data, setData] = useState<AiConnectorSummaryResponse | null>(null);
  const [accessLogs, setAccessLogs] = useState<AiConnectorAccessLogDto[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setIsLoadingLogs(true);
    setError("");
    try {
      const [summary, logs] = await Promise.all([
        fetchAiConnectorSummary(),
        fetchAiConnectorLogs(12).catch(() => ({ accessLogs: [] })),
      ]);
      setData(summary);
      setAccessLogs(logs.accessLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI connector settings could not be loaded.");
      setAccessLogs([]);
    } finally {
      setIsLoading(false);
      setIsLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeEnabledByGroup = useMemo(() => ({
    read: data?.policy.groupToggles.read ?? false,
    drafts: data?.policy.groupToggles.drafts ?? false,
    write: data?.policy.groupToggles.write ?? false,
  }), [data]);
  const allScopeGroupsDisabled = data !== null
    && !scopeEnabledByGroup.read
    && !scopeEnabledByGroup.drafts
    && !scopeEnabledByGroup.write;

  async function toggleScope(connection: AiConnectorConnectionDto, scope: AiConnectorScope, checked: boolean) {
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const nextScopes = checked
        ? [...new Set([...connection.scopes, scope])]
        : connection.scopes.filter((item) => item !== scope);
      const updated = await updateAiConnector(connection.id, { scopes: nextScopes });
      setData((current) => current
        ? {
            ...current,
            connections: current.connections.map((item) => item.id === updated.id ? updated : item),
          }
        : current);
      setMessage("Connector permissions saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connector update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTool(connection: AiConnectorConnectionDto, toolName: string, checked: boolean) {
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const updated = await updateAiConnector(connection.id, {
        toolToggles: { ...connection.toolToggles, [toolName]: checked },
      });
      setData((current) => current
        ? {
            ...current,
            connections: current.connections.map((item) => item.id === updated.id ? updated : item),
          }
        : current);
      setMessage("Tool toggle saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tool toggle update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(connection: AiConnectorConnectionDto) {
    if (!window.confirm(`Revoke ${connection.displayName}?`)) return;
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const updated = await revokeAiConnector(connection.id);
      setData((current) => current
        ? {
            ...current,
            connections: current.connections.map((item) => item.id === updated.id ? updated : item),
          }
        : current);
      setMessage("Connector revoked.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connector revoke failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5" data-testid="settings-ai-connectors-page">
      <div className="flex flex-col gap-3 rounded-[1.75rem] border border-border bg-card px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">AI settings</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">AI Connectors</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Manage MCP clients connected to your Vakwen account and review their granted scopes.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}

      <Card className="rounded-[1.5rem]">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Deployment</p>
            <p className="mt-1 font-medium text-foreground">{data ? data.policy.enabled ? "Enabled" : "Disabled" : "-"}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Active connection cap</p>
            <p className="mt-1 font-medium text-foreground">{policyValue(data?.policy.maxActiveConnectionsPerUser)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Inactivity expiry</p>
            <p className="mt-1 font-medium text-foreground">{policyValue(data?.policy.inactivityExpiryDays, " days")}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Expiry warning</p>
            <p className="mt-1 font-medium text-foreground">{policyValue(data?.policy.expirationWarningDays, " days")}</p>
          </div>
        </div>
      </Card>

      {allScopeGroupsDisabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          Admin policy has disabled all MCP tool groups. Connector permissions cannot be changed until an admin re-enables at least one group.
        </div>
      ) : null}

      {isLoading ? (
        <Card className="rounded-[1.5rem]" role="status" aria-live="polite" aria-busy="true"><p className="text-sm text-muted-foreground">Loading connectors...</p></Card>
      ) : data && data.connections.length === 0 ? (
        <Card className="rounded-[1.5rem] border-dashed">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">No AI connectors are connected.</p>
            <p className="text-sm text-muted-foreground">Start a connector flow from ChatGPT, then return here to review connection status and scope toggles.</p>
          </div>
        </Card>
      ) : (
        data?.connections.map((connection) => (
          <Card key={connection.id} className="rounded-[1.5rem]" data-testid={`ai-connector-${connection.id}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{connection.displayName}</h2>
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
                    {connection.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{connection.provider} · last used {formatTime(connection.lastUsedAt)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Expires {formatTime(connection.expiresAt)}</p>
                {connection.status === "pending" ? (
                  <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700" role="status" aria-live="polite">
                    Waiting for ChatGPT to exchange the authorization code.
                  </p>
                ) : null}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void revoke(connection)}
                disabled={busyId === connection.id || connection.status === "revoked"}
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                Revoke
              </Button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {GROUPED_SCOPES.map((group) => (
                <div key={group.title} className="rounded-2xl border border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground">{group.title}</p>
                  <div className="mt-3 space-y-2">
                    {group.scopes.map((scope) => {
                      const policyDisabled =
                        (scope === "portfolio:mcp_read" && !scopeEnabledByGroup.read)
                        || (scope === "account:manage" && !scopeEnabledByGroup.write)
                        || (scope.startsWith("transaction_draft") && !scopeEnabledByGroup.drafts)
                        || (scope === "transaction:write" && !scopeEnabledByGroup.write);
                      const policyDescriptionId = policyDisabled ? `${connection.id}-${scope.replace(/[:_]/g, "-")}-policy-disabled` : undefined;
                      const reconnectRequired = scopeNeedsReconnect(connection, scope);
                      const reconnectDescriptionId = reconnectRequired ? `${connection.id}-${scope.replace(/[:_]/g, "-")}-reconnect-required` : undefined;
                      const disabled =
                        busyId === connection.id
                        || connection.status !== "active"
                        || policyDisabled
                        || reconnectRequired;
                      const describedBy = [policyDescriptionId, reconnectDescriptionId].filter(Boolean).join(" ") || undefined;
                      return (
                        <label key={scope} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-background/80">
                          <span className="min-w-0">
                            {AI_CONNECTOR_SCOPE_LABELS[scope]}
                            {policyDisabled ? (
                              <span id={policyDescriptionId} className="block text-xs text-slate-500">
                                Disabled by MCP policy
                              </span>
                            ) : null}
                            {reconnectRequired ? (
                              <span id={reconnectDescriptionId} className="mt-1 block text-xs text-amber-700">
                                {reconnectCopy(scope)}
                              </span>
                            ) : null}
                          </span>
                          <input
                            type="checkbox"
                            checked={connection.scopes.includes(scope)}
                            disabled={disabled}
                            aria-describedby={describedBy}
                            onChange={(event) => void toggleScope(connection, scope, event.target.checked)}
                          />
                        </label>
                      );
                    })}
                  </div>
                  {group.title === "Posting" ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                      `transaction:write` stays off by default and cannot be granted from this settings page.
                      Use ChatGPT consent to opt in, or revoke and reconnect if you need to request it again.
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {connection.provider === "chatgpt" ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                <span className="min-w-0 flex-1">
                  Need fresh auth or re-consent? Start the connector flow again in ChatGPT, then approve the missing account-management or posting scopes there.
                </span>
                <a
                  href={CHATGPT_RECONNECT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-900 transition hover:border-slate-400"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Reconnect in ChatGPT
                </a>
              </div>
            ) : null}

            <div className="mt-5">
              <p className="text-sm font-medium text-foreground">Tool toggles</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {Object.entries(connection.toolToggles).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tool-level overrides.</p>
                ) : Object.entries(connection.toolToggles).map(([toolName, enabled]) => (
                  <label key={toolName} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span className="truncate">{toolName}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={busyId === connection.id || connection.status !== "active"}
                      onChange={(event) => void toggleTool(connection, toolName, event.target.checked)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </Card>
        ))
      )}

      {isLoadingLogs ? (
        <Card className="rounded-[1.5rem]" role="status" aria-live="polite" aria-busy="true">
          <p className="text-sm text-muted-foreground">Loading recent access...</p>
        </Card>
      ) : accessLogs.length > 0 ? (
        <Card className="rounded-[1.5rem]">
          <h2 className="text-base font-semibold text-foreground">Recent access</h2>
          <div className="mt-3 divide-y divide-border">
            {accessLogs.map((log) => (
              <div key={log.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-foreground">{log.toolName}</span>
                <span className="text-muted-foreground">{log.accessKind} · {log.result} · {new Date(log.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
