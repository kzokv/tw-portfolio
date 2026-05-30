"use client";

// KZO-198 — Repair cooldown bounds, like every other Tier 1 numeric knob,
// flow from `apps/api/src/services/appConfig/bounds.ts` → DTO → UI. The
// `NumericOverrideRow` component reads `min`/`max` from `config.bounds`
// directly; no module-level constants are duplicated in this file.

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type AiConnectorPolicySettingsDto,
  type AppConfigDto,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  dashboardPerformanceRangesSchema,
} from "@vakwen/shared-types";
import { getJson, patchJson, postJson, ApiError } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from "../ui/Tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import { SortableRangeList, type SortableRangeRow } from "../settings/SortableRangeList";
import { NumericOverrideRow } from "./NumericOverrideRow";
import { MaskedSecretInput } from "./MaskedSecretInput";

// KZO-199 — locked tab structure. Architect-design.md §0:
//   admin-settings-tabs                  — list container
//   admin-settings-tab-{slug}            — trigger
//   admin-settings-panel-{slug}          — panel
const TAB_SLUGS = [
  "rate-limits",
  "sharing",
  "provider-health",
  "backfill-repair",
  "catalog-metadata",
  "display-defaults",
  "api-keys",
  "mcp",
] as const;
type TabSlug = (typeof TAB_SLUGS)[number];
const DEFAULT_TAB: TabSlug = "rate-limits";

const TAB_LABELS: Record<TabSlug, string> = {
  "rate-limits": "Rate limits",
  "sharing": "Sharing",
  "provider-health": "Provider health",
  "backfill-repair": "Backfill & repair",
  "catalog-metadata": "Catalog & metadata",
  "display-defaults": "Display defaults",
  "api-keys": "API keys",
  "mcp": "MCP",
};

const TAB_DESCRIPTIONS: Record<TabSlug, string> = {
  "rate-limits": "Traffic windows, budgets, and request throttles.",
  "sharing": "Public-link caps and anonymous share guardrails.",
  "provider-health": "Provider cooldowns, retention, and alert suppression.",
  "backfill-repair": "Repair retries and backfill pacing defaults.",
  "catalog-metadata": "Catalog absence thresholds and metadata enrichment mode.",
  "display-defaults": "New-account display defaults and dashboard timeframes.",
  "api-keys": "Encrypted provider secrets stored in app config.",
  "mcp": "Global AI connector policy and OAuth redirect allowlist.",
};

function isValidTabSlug(value: string | null): value is TabSlug {
  return value !== null && (TAB_SLUGS as readonly string[]).includes(value);
}

interface AdminSettingsClientProps {
  initial: AppConfigDto;
}

type McpNumericSettingKey =
  | "maxActiveConnectionsPerUser"
  | "inactivityExpiryDays"
  | "expirationWarningDays"
  | "maxConnectorLifetimeDays";

const MCP_NUMERIC_FIELDS: Array<{
  key: McpNumericSettingKey;
  label: string;
  min: number;
  max: number;
}> = [
  { key: "maxActiveConnectionsPerUser", label: "Max active connectors", min: 1, max: 20 },
  { key: "inactivityExpiryDays", label: "Inactivity expiry days", min: 1, max: 365 },
  { key: "expirationWarningDays", label: "Expiry warning days", min: 1, max: 30 },
  { key: "maxConnectorLifetimeDays", label: "Max connector lifetime days", min: 1, max: 365 },
];

function numericDraftsFromSettings(
  settings: AiConnectorPolicySettingsDto,
): Record<McpNumericSettingKey, string> {
  return {
    maxActiveConnectionsPerUser: String(settings.maxActiveConnectionsPerUser),
    inactivityExpiryDays: String(settings.inactivityExpiryDays),
    expirationWarningDays: String(settings.expirationWarningDays),
    maxConnectorLifetimeDays: String(settings.maxConnectorLifetimeDays),
  };
}

function parseMcpNumericDrafts(
  drafts: Record<McpNumericSettingKey, string>,
): Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey> {
  return Object.fromEntries(MCP_NUMERIC_FIELDS.map((field) => {
    const value = Number(drafts[field.key]);
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      throw new Error(`${field.label} must be an integer from ${field.min} to ${field.max}.`);
    }
    return [field.key, value];
  })) as Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey>;
}

const MCP_REDIRECT_ALLOWLIST_EXAMPLES = [
  "https://chatgpt.com/connector/oauth/<connector-id>",
  "https://chat.openai.com/connector/oauth/<connector-id>",
  "https://chatgpt.com/aip/oauth/callback",
  "https://chatgpt.com/aip/<gpt-id>/oauth/callback",
] as const;

function redirectAllowlistDraftFromSettings(settings: AiConnectorPolicySettingsDto): string {
  return settings.oauthRedirectUriAllowlist.join("\n");
}

function parseRedirectAllowlistDraft(draft: string): string[] {
  const values = draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized: string[] = [];
  for (const value of values) {
    if (value.includes("<") || value.includes(">")) {
      throw new Error("Replace example placeholders before saving redirect URIs.");
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Each redirect URI must be a valid URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname === "/") {
      throw new Error("Each redirect URI must be an exact HTTPS path URL without query or hash.");
    }
    normalized.push(url.toString());
  }
  return [...new Set(normalized)];
}

function generateHexSecret(bytes = 32): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random generation is unavailable in this browser.");
  }
  const values = new Uint8Array(bytes);
  cryptoApi.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

// KZO-159: Predefined chip palette for the Dashboard Timeframe Defaults section.
// `DEFAULT_DASHBOARD_PERFORMANCE_RANGES` (4 items) is the fallback active selection;
// this 6-chip palette includes longer ranges that admins commonly toggle on.
const PREDEFINED_TIMEFRAME_CHIPS = ["1M", "3M", "YTD", "1Y", "5Y", "10Y"] as const;

// String-template i18n strings (per `.claude/rules/nextjs-i18n-serialization.md` —
// no functions in strings that may cross server→client boundaries).
const TIMEFRAME_HELPER_TEXT =
  "Users can override these defaults in their own Display Preferences.";
const TIMEFRAME_INVALID_FORMAT_MSG =
  "Invalid range format. Use e.g. 1M, 3M, 1Y, YTD, ALL.";
const TIMEFRAME_DUPLICATE_MSG = "That range is already in the list.";
const TIMEFRAME_EMPTY_LIST_MSG = "Add at least one timeframe.";
const TIMEFRAME_LIST_TOO_LONG_MSG = "Maximum 12 timeframes allowed.";

// Single-element validity check via the shared zod schema. Wrapping the
// candidate in a one-element array reuses the schema's element validator
// without duplicating the regex on the client (per design D9 — single
// source of truth for the range grammar).
function isValidPerformanceRange(value: string): boolean {
  return dashboardPerformanceRangesSchema.safeParse([value]).success;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function AdminMcpSettingsPanel({ active }: { active: boolean }) {
  const [settings, setSettings] = useState<AiConnectorPolicySettingsDto | null>(null);
  const [issuerDraft, setIssuerDraft] = useState("");
  const [redirectAllowlistDraft, setRedirectAllowlistDraft] = useState("");
  const [numericDrafts, setNumericDrafts] = useState<Record<McpNumericSettingKey, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!active || settings !== null) return;
    let cancelled = false;
    getJson<AiConnectorPolicySettingsDto>("/admin/mcp/settings")
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setIssuerDraft(next.oauthPublicIssuer ?? "");
          setRedirectAllowlistDraft(redirectAllowlistDraftFromSettings(next));
          setNumericDrafts(numericDraftsFromSettings(next));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load MCP settings.");
      });
    return () => { cancelled = true; };
  }, [active, settings]);

  async function save(patch: Partial<AiConnectorPolicySettingsDto> & { mcpOauthTokenSecret?: string | null }) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await postJson<{ freshAuthToken: string }>("/admin/mcp/fresh-auth", {});
      const updated = await patchJson<AiConnectorPolicySettingsDto>(
        "/admin/mcp/settings",
        patch,
        { headers: { "x-vakwen-fresh-auth-at": token.freshAuthToken } },
      );
      setSettings(updated);
      setIssuerDraft(updated.oauthPublicIssuer ?? "");
      setRedirectAllowlistDraft(redirectAllowlistDraftFromSettings(updated));
      setNumericDrafts(numericDraftsFromSettings(updated));
      setSuccess("MCP settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save MCP settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <Card data-testid="admin-settings-mcp-section">
        <p
          className="text-sm text-slate-600"
          role={error ? "alert" : "status"}
          aria-live="polite"
          aria-busy={error ? undefined : true}
        >
          {error ?? "Loading MCP settings..."}
        </p>
      </Card>
    );
  }

  const allGroupsDisabled = !settings.groupToggles.read
    && !settings.groupToggles.drafts
    && !settings.groupToggles.write;
  const currentNumericDrafts = numericDrafts ?? numericDraftsFromSettings(settings);
  let numericValidation: string | null = null;
  let numericPatch: Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey> | null = null;
  try {
    numericPatch = parseMcpNumericDrafts(currentNumericDrafts);
  } catch (err) {
    numericValidation = err instanceof Error ? err.message : "Numeric MCP settings are invalid.";
  }
  const numericDirty = MCP_NUMERIC_FIELDS.some((field) => currentNumericDrafts[field.key] !== String(settings[field.key]));
  let redirectAllowlistValidation: string | null = null;
  let redirectAllowlistValues: string[] | null = null;
  try {
    redirectAllowlistValues = parseRedirectAllowlistDraft(redirectAllowlistDraft);
  } catch (err) {
    redirectAllowlistValidation = err instanceof Error ? err.message : "Redirect URI allowlist is invalid.";
  }
  const redirectAllowlistSavedDraft = redirectAllowlistDraftFromSettings(settings);
  const redirectAllowlistDraftChanged = redirectAllowlistDraft !== redirectAllowlistSavedDraft;
  const redirectAllowlistDirty = redirectAllowlistValues !== null
    && redirectAllowlistValues.join("\n") !== settings.oauthRedirectUriAllowlist.join("\n");
  const redirectAllowlistDescriptionIds = [
    "admin-settings-mcp-redirect-help",
    "admin-settings-mcp-redirect-examples",
    redirectAllowlistValidation ? "admin-settings-mcp-redirect-error" : null,
  ].filter(Boolean).join(" ");

  return (
    <Card data-testid="admin-settings-mcp-section">
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">MCP settings</h2>
          <p className="mt-1 text-sm text-slate-600">
            Global AI connector policy. Fresh-auth is requested automatically before saving.
          </p>
        </div>

        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p> : null}
        {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status" aria-live="polite">{success}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
            <span className="font-medium text-slate-800">MCP deployment</span>
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={saving}
              onChange={(event) => void save({ enabled: event.target.checked })}
            />
          </label>
          {(["read", "drafts", "write"] as const).map((group) => (
            <label key={group} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <span className="font-medium capitalize text-slate-800">{group} tools</span>
              <input
                type="checkbox"
                checked={settings.groupToggles[group]}
                disabled={saving}
                onChange={(event) => void save({ groupToggles: { ...settings.groupToggles, [group]: event.target.checked } })}
              />
            </label>
          ))}
        </div>

        {allGroupsDisabled ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
            All MCP tool groups are disabled. New ChatGPT consent approvals are blocked and user connector scope controls stay disabled until an admin re-enables at least one group.
          </p>
        ) : null}

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <div className="grid gap-4 md:grid-cols-3">
            {MCP_NUMERIC_FIELDS.map((field) => (
              <label key={field.key} className="text-sm font-medium text-slate-700">
                {field.label}
                <input
                  type="number"
                  value={currentNumericDrafts[field.key]}
                  min={field.min}
                  max={field.max}
                  disabled={saving}
                  onChange={(event) => {
                    const { value } = event.target;
                    setNumericDrafts((current) => ({
                      ...(current ?? numericDraftsFromSettings(settings)),
                      [field.key]: value,
                    }));
                  }}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </label>
            ))}
          </div>
          {numericValidation ? (
            <p className="mt-3 text-sm text-red-700" role="alert">{numericValidation}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || !numericDirty}
              onClick={() => setNumericDrafts(numericDraftsFromSettings(settings))}
            >
              Reset limits
            </Button>
            <Button
              size="sm"
              disabled={saving || !numericDirty || numericValidation !== null || numericPatch === null}
              onClick={() => {
                if (numericPatch) void save(numericPatch);
              }}
            >
              Save limits
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <label className="text-sm font-medium text-slate-700">
            Public OAuth issuer
            <input
              type="url"
              value={issuerDraft}
              disabled={saving}
              placeholder="https://api.example.com"
              onChange={(event) => setIssuerDraft(event.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2"
            />
          </label>
          <div className="mt-3 flex justify-end gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setIssuerDraft(settings.oauthPublicIssuer ?? "");
              }}
            >
              Reset
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void save({ oauthPublicIssuer: issuerDraft.trim() || null })}
            >
              Save issuer
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <label className="text-sm font-medium text-slate-700">
            Additional redirect URI allowlist
            <textarea
              value={redirectAllowlistDraft}
              disabled={saving}
              placeholder="https://chatgpt.com/connector/oauth/abc123"
              onChange={(event) => setRedirectAllowlistDraft(event.target.value)}
              className="mt-1 block min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
              data-testid="admin-settings-mcp-redirect-allowlist"
              aria-describedby={redirectAllowlistDescriptionIds}
              aria-invalid={redirectAllowlistValidation ? true : undefined}
            />
          </label>
          <p id="admin-settings-mcp-redirect-help" className="mt-2 text-xs text-slate-500">
            One exact HTTPS redirect URI per line. Built-in ChatGPT redirect patterns are always allowed.
          </p>
          <div id="admin-settings-mcp-redirect-examples" className="mt-3 rounded-xl bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Examples</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {MCP_REDIRECT_ALLOWLIST_EXAMPLES.map((example) => (
                <li key={example} className="font-mono">{example}</li>
              ))}
            </ul>
          </div>
          {redirectAllowlistValidation ? (
            <p id="admin-settings-mcp-redirect-error" className="mt-3 text-sm text-red-700" role="alert">{redirectAllowlistValidation}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || !redirectAllowlistDraftChanged}
              onClick={() => setRedirectAllowlistDraft(redirectAllowlistDraftFromSettings(settings))}
            >
              Reset allowlist
            </Button>
            <Button
              size="sm"
              disabled={saving || !redirectAllowlistDirty || redirectAllowlistValues === null}
              onClick={() => {
                if (redirectAllowlistValues) void save({ oauthRedirectUriAllowlist: redirectAllowlistValues });
              }}
            >
              Save allowlist
            </Button>
          </div>
        </div>

        <MaskedSecretInput
          fieldKey="mcp-oauth-token-secret"
          label="MCP OAuth token secret"
          description="HMAC secret used to sign MCP access tokens and hash OAuth codes and refresh tokens."
          isSet={settings.oauthTokenSecretSet}
          secretLengthBounds={{ min: 32, max: 500 }}
          disabled={saving}
          generateLabel="Generate 64-hex secret"
          onGenerateValue={() => generateHexSecret(32)}
          onRotate={(plaintext) => save({ mcpOauthTokenSecret: plaintext })}
          onClear={() => save({ mcpOauthTokenSecret: null })}
        />
      </div>
    </Card>
  );
}

export function AdminSettingsClient({ initial }: AdminSettingsClientProps) {
  const [config, setConfig] = useState<AppConfigDto>(initial);

  // ── KZO-199: Tab state synced to ?tab=<slug> URL query ────────────────────
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = isValidTabSlug(searchParams?.get("tab") ?? null)
    ? (searchParams!.get("tab") as TabSlug)
    : DEFAULT_TAB;
  const [activeTab, setActiveTab] = useState<TabSlug>(initialTab);

  // Sync local state if the URL changes (e.g. browser back/forward) without
  // a remount.
  useEffect(() => {
    // Sync local `activeTab` from URL on browser back/forward (no remount).
    // `activeTab` is in deps so the effect's stale closure can't overwrite a
    // newer state; the inner `fromUrl !== activeTab` guard breaks any
    // self-feedback (URL update → effect → setActiveTab is a no-op when the
    // URL already matches).
    const fromUrl = searchParams?.get("tab") ?? null;
    if (isValidTabSlug(fromUrl) && fromUrl !== activeTab) {
      setActiveTab(fromUrl);
    }
  }, [searchParams, activeTab]);

  function handleTabChange(next: string) {
    if (!isValidTabSlug(next)) return;
    setActiveTab(next);
    // Update URL synchronously via the History API so `page.url()` reflects
    // `?tab=<slug>` immediately after the click (E2E spec asserts on it).
    // Next.js's `router.replace` from `next/navigation` is fire-and-forget
    // and briefly lags `page.url()`. Pair with `router.replace` so Next.js's
    // internal router state stays in sync (covers cases where the URL is
    // later read via `useSearchParams`).
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    const url = `/admin/settings?${params.toString()}`;
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", url);
    }
    router.replace(url, { scroll: false });
  }

  // ── Dashboard Timeframe Defaults section state (KZO-159) ───────────────────
  const [pendingRanges, setPendingRanges] = useState<string[]>(
    initial.dashboardPerformanceRanges && initial.dashboardPerformanceRanges.length > 0
      ? [...initial.dashboardPerformanceRanges]
      : [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
  );
  const [customInput, setCustomInput] = useState("");
  const [timeframeSaving, setTimeframeSaving] = useState(false);
  const [timeframeServerError, setTimeframeServerError] = useState<string | null>(null);
  const [timeframeSaveSuccess, setTimeframeSaveSuccess] = useState<string | null>(null);

  // ── Metadata Enrichment Mode section state (KZO-189) ───────────────────────
  // The select value is "" when the admin is using the env default (override
  // cleared); otherwise the explicit override string. PATCH translates "" → null.
  const [metadataEnrichmentMode, setMetadataEnrichmentMode] = useState<string>(
    initial.metadataEnrichmentMode ?? "",
  );
  const [metadataModeSaving, setMetadataModeSaving] = useState(false);
  const [metadataModeError, setMetadataModeError] = useState<string | null>(null);
  const [metadataModeSuccess, setMetadataModeSuccess] = useState<string | null>(null);

  // ── Timeframe section derived state ────────────────────────────────────────
  const trimmedCustomInput = customInput.trim();
  let customInputError: string | null = null;
  if (trimmedCustomInput !== "") {
    if (!isValidPerformanceRange(trimmedCustomInput)) {
      customInputError = TIMEFRAME_INVALID_FORMAT_MSG;
    } else if (pendingRanges.includes(trimmedCustomInput)) {
      customInputError = TIMEFRAME_DUPLICATE_MSG;
    } else if (pendingRanges.length >= 12) {
      customInputError = TIMEFRAME_LIST_TOO_LONG_MSG;
    }
  }

  const listValidation = dashboardPerformanceRangesSchema.safeParse(pendingRanges);
  const listValidationError =
    pendingRanges.length === 0
      ? TIMEFRAME_EMPTY_LIST_MSG
      : listValidation.success
        ? null
        : pendingRanges.length > 12
          ? TIMEFRAME_LIST_TOO_LONG_MSG
          : TIMEFRAME_INVALID_FORMAT_MSG;

  const displayedTimeframeError = customInputError ?? listValidationError ?? timeframeServerError;
  const canAddCustom = !timeframeSaving && trimmedCustomInput !== "" && customInputError === null;
  const canSaveTimeframes =
    !timeframeSaving && pendingRanges.length > 0 && listValidation.success;
  const availablePredefinedChips = PREDEFINED_TIMEFRAME_CHIPS.filter(
    (range) => !pendingRanges.includes(range),
  );

  // ── Timeframe section handlers (KZO-159) ───────────────────────────────────
  function clearTimeframeFeedback() {
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
  }

  function reorderChips(nextOrder: string[]) {
    setPendingRanges(nextOrder);
    clearTimeframeFeedback();
  }

  function toggleChip(range: string) {
    setPendingRanges((prev) =>
      prev.includes(range) ? prev.filter((r) => r !== range) : [...prev, range],
    );
    clearTimeframeFeedback();
  }

  function handleAddCustom() {
    if (!canAddCustom) return;
    setPendingRanges((prev) => [...prev, trimmedCustomInput]);
    setCustomInput("");
    clearTimeframeFeedback();
  }

  async function handleSaveTimeframes() {
    if (!canSaveTimeframes) return;
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
    setTimeframeSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        dashboardPerformanceRanges: pendingRanges,
      });
      setConfig(updated);
      setPendingRanges(
        updated.dashboardPerformanceRanges && updated.dashboardPerformanceRanges.length > 0
          ? [...updated.dashboardPerformanceRanges]
          : [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
      );
      setTimeframeSaveSuccess("Timeframes saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setTimeframeServerError(err.message);
      } else if (err instanceof Error) {
        setTimeframeServerError(err.message);
      } else {
        setTimeframeServerError("Failed to save timeframes.");
      }
    } finally {
      setTimeframeSaving(false);
    }
  }

  // ── Metadata Enrichment Mode handlers (KZO-189) ────────────────────────────
  async function handleSaveMetadataMode() {
    setMetadataModeError(null);
    setMetadataModeSuccess(null);
    setMetadataModeSaving(true);
    try {
      const next = metadataEnrichmentMode === "" ? null : metadataEnrichmentMode;
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        metadataEnrichmentMode: next,
      });
      setConfig(updated);
      setMetadataEnrichmentMode(updated.metadataEnrichmentMode ?? "");
      setMetadataModeSuccess("Metadata enrichment mode saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setMetadataModeError(err.message);
      } else if (err instanceof Error) {
        setMetadataModeError(err.message);
      } else {
        setMetadataModeError("Failed to save metadata enrichment mode.");
      }
    } finally {
      setMetadataModeSaving(false);
    }
  }

  // ── KZO-198 Tier 1 numeric override rows + Tier 0 secret rotations ────────
  // A single generic PATCH handler keyed by DTO field name. Each
  // `NumericOverrideRow` and `MaskedSecretInput` calls this with the field
  // name + next value (`null` = reset to env default for Tier 1, or clear
  // for Tier 0). Errors propagate so the row component can render them
  // inline; success refreshes `config` so effective values stay accurate.
  async function patchAppConfigField(field: string, value: number | string | null): Promise<void> {
    const updated = await patchJson<AppConfigDto>("/admin/settings", { [field]: value });
    setConfig(updated);
  }

  async function handleResetTimeframes() {
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
    setTimeframeSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        dashboardPerformanceRanges: null,
      });
      setConfig(updated);
      setPendingRanges([...DEFAULT_DASHBOARD_PERFORMANCE_RANGES]);
      setCustomInput("");
      setTimeframeSaveSuccess("Reset to defaults.");
    } catch (err) {
      if (err instanceof ApiError) {
        setTimeframeServerError(err.message);
      } else if (err instanceof Error) {
        setTimeframeServerError(err.message);
      } else {
        setTimeframeServerError("Failed to reset timeframes.");
      }
    } finally {
      setTimeframeSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="admin-settings-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Runtime configuration. Changes apply immediately and are recorded in the audit log.
        </p>
      </div>

      <TabsRoot value={activeTab} onValueChange={handleTabChange}>
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="hidden px-4 py-4 md:block hover:translate-y-0">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-primary/78">Sections</p>
                <p className="text-sm text-slate-600">
                  Keep admin settings on one query-driven page while grouping related controls by task.
                </p>
              </div>
              <TabsList
                data-testid="admin-settings-tabs"
                className="mt-4 hidden h-auto w-full flex-col items-stretch gap-1 overflow-visible rounded-2xl border-0 bg-transparent p-0 md:flex"
              >
                {TAB_SLUGS.map((slug) => (
                  <TabsTrigger
                    key={slug}
                    value={slug}
                    data-testid={`admin-settings-tab-${slug}`}
                    className={cn(
                      "h-auto w-full items-start justify-start rounded-xl border border-transparent px-3 py-3 text-left",
                      "data-[state=active]:border-slate-200 data-[state=active]:bg-white",
                    )}
                  >
                    <span className="block text-sm font-semibold">{TAB_LABELS[slug]}</span>
                    <span className="mt-1 block whitespace-normal text-xs font-normal text-slate-500">
                      {TAB_DESCRIPTIONS[slug]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Card>

            <div className="md:hidden">
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="admin-settings-mobile-nav">
                Section
              </label>
              <Select value={activeTab} onValueChange={handleTabChange}>
                <SelectTrigger id="admin-settings-mobile-nav" className="w-full" data-testid="admin-settings-mobile-nav">
                  <SelectValue placeholder={TAB_LABELS[activeTab]} />
                </SelectTrigger>
                <SelectContent>
                  {TAB_SLUGS.map((slug) => (
                    <SelectItem key={slug} value={slug}>
                      {TAB_LABELS[slug]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-sm text-slate-500">{TAB_DESCRIPTIONS[activeTab]}</p>
            </div>
          </div>

          <div className="min-w-0">

        {/* ── Rate limits tab ───────────────────────────────────────────── */}
        <TabsContent value="rate-limits" data-testid="admin-settings-panel-rate-limits">
          <Card data-testid="admin-settings-rate-limits-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Rate limits</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Per-IP rate-limiter windows and request budgets. Empty override → fall back to environment value.
                </p>
              </div>
              <NumericOverrideRow
                fieldKey="market-data-price-window-ms"
                label="Market data price · window"
                override={config.marketDataPriceWindowMs}
                effective={config.effectiveMarketDataPriceWindowMs}
                bounds={config.bounds.marketDataPriceWindowMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("marketDataPriceWindowMs", v)}
              />
              <NumericOverrideRow
                fieldKey="market-data-price-limit"
                label="Market data price · limit"
                override={config.marketDataPriceLimit}
                effective={config.effectiveMarketDataPriceLimit}
                bounds={config.bounds.marketDataPriceLimit}
                unit="req/window"
                onSave={(v) => patchAppConfigField("marketDataPriceLimit", v)}
              />
              <NumericOverrideRow
                fieldKey="market-data-search-window-ms"
                label="Market data search · window"
                override={config.marketDataSearchWindowMs}
                effective={config.effectiveMarketDataSearchWindowMs}
                bounds={config.bounds.marketDataSearchWindowMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("marketDataSearchWindowMs", v)}
              />
              <NumericOverrideRow
                fieldKey="market-data-search-limit"
                label="Market data search · limit"
                override={config.marketDataSearchLimit}
                effective={config.effectiveMarketDataSearchLimit}
                bounds={config.bounds.marketDataSearchLimit}
                unit="req/window"
                onSave={(v) => patchAppConfigField("marketDataSearchLimit", v)}
              />
              <NumericOverrideRow
                fieldKey="invite-status-window-ms"
                label="Invite status · window"
                override={config.inviteStatusWindowMs}
                effective={config.effectiveInviteStatusWindowMs}
                bounds={config.bounds.inviteStatusWindowMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("inviteStatusWindowMs", v)}
              />
              <NumericOverrideRow
                fieldKey="invite-status-limit"
                label="Invite status · limit"
                override={config.inviteStatusLimit}
                effective={config.effectiveInviteStatusLimit}
                bounds={config.bounds.inviteStatusLimit}
                unit="req/window"
                onSave={(v) => patchAppConfigField("inviteStatusLimit", v)}
              />
            </div>
          </Card>
        </TabsContent>

        {/* ── Sharing tab (KZO-199 NEW) ─────────────────────────────────── */}
        <TabsContent value="sharing" data-testid="admin-settings-panel-sharing">
          <Card data-testid="admin-settings-sharing-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Sharing</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Anonymous-share-token cap and per-IP rate limits. Off = use the environment default.
                </p>
              </div>
              <NumericOverrideRow
                fieldKey="anonymousShareTokenCap"
                label="Anonymous share token cap"
                description="Maximum active anonymous share tokens per owner. New token requests above this fail with cap-exceeded."
                override={config.anonymousShareTokenCap}
                effective={config.effectiveAnonymousShareTokenCap}
                bounds={config.bounds.anonymousShareTokenCap}
                unit="tokens"
                inputTestId="admin-settings-input-anonymousShareTokenCap"
                onSave={(v) => patchAppConfigField("anonymousShareTokenCap", v)}
              />
              <NumericOverrideRow
                fieldKey="anonymousShareRateLimitMax"
                label="Anonymous share rate limit · max"
                description="Maximum requests per window for anonymous-share endpoints (per IP)."
                override={config.anonymousShareRateLimitMax}
                effective={config.effectiveAnonymousShareRateLimitMax}
                bounds={config.bounds.anonymousShareRateLimitMax}
                unit="req/window"
                inputTestId="admin-settings-input-anonymousShareRateLimitMax"
                onSave={(v) => patchAppConfigField("anonymousShareRateLimitMax", v)}
              />
              <NumericOverrideRow
                fieldKey="anonymousShareRateLimitWindowMs"
                label="Anonymous share rate limit · window"
                description="Sliding-window length for the anonymous-share rate limiter."
                override={config.anonymousShareRateLimitWindowMs}
                effective={config.effectiveAnonymousShareRateLimitWindowMs}
                bounds={config.bounds.anonymousShareRateLimitWindowMs}
                unit="ms"
                inputTestId="admin-settings-input-anonymousShareRateLimitWindowMs"
                onSave={(v) => patchAppConfigField("anonymousShareRateLimitWindowMs", v)}
              />
            </div>
          </Card>
        </TabsContent>

        {/* ── Provider health tab ───────────────────────────────────────── */}
        <TabsContent value="provider-health" data-testid="admin-settings-panel-provider-health">
          <Card data-testid="admin-settings-provider-health-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Provider health</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Notification suppression, error-trail retention, and re-run cooldown for the provider health surface.
                </p>
              </div>
              <NumericOverrideRow
                fieldKey="provider-down-suppression-ms"
                label="Down notification suppression"
                description="Cooldown between repeat 'provider down' notifications for the same provider+market."
                override={config.providerDownNotificationSuppressionMs}
                effective={config.effectiveProviderDownNotificationSuppressionMs}
                bounds={config.bounds.providerDownNotificationSuppressionMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("providerDownNotificationSuppressionMs", v)}
              />
              <NumericOverrideRow
                fieldKey="provider-error-trail-retention-days"
                label="Error trail retention"
                description="Days of historical provider errors to keep before the purge cron evicts them."
                override={config.providerErrorTrailRetentionDays}
                effective={config.effectiveProviderErrorTrailRetentionDays}
                bounds={config.bounds.providerErrorTrailRetentionDays}
                unit="days"
                onSave={(v) => patchAppConfigField("providerErrorTrailRetentionDays", v)}
              />
              <NumericOverrideRow
                fieldKey="provider-rerun-cooldown-ms"
                label="Re-run cooldown"
                description="Minimum interval between admin-triggered re-runs for the same provider+market."
                override={config.providerRerunCooldownMs}
                effective={config.effectiveProviderRerunCooldownMs}
                bounds={config.bounds.providerRerunCooldownMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("providerRerunCooldownMs", v)}
              />
              {/* KZO-197 (surfaced in KZO-199 Phase 4) — yahoo-finance-au override. */}
              <NumericOverrideRow
                fieldKey="yahooAuRerunCooldownMs"
                label="Yahoo Finance AU re-run cooldown"
                description="Yahoo-AU-specific override for the re-run cooldown. Falls back to the generic re-run cooldown when off."
                override={config.yahooAuRerunCooldownMs}
                effective={config.effectiveYahooAuRerunCooldownMs}
                bounds={config.bounds.yahooAuRerunCooldownMs}
                unit="ms"
                inputTestId="admin-settings-input-yahooAuRerunCooldownMs"
                onSave={(v) => patchAppConfigField("yahooAuRerunCooldownMs", v)}
              />
            </div>
          </Card>
        </TabsContent>

        {/* ── Backfill & repair tab (Repair cooldown + Backfill knobs) ─── */}
        <TabsContent value="backfill-repair" data-testid="admin-settings-panel-backfill-repair">
          <div className="space-y-6">
            <Card data-testid="admin-settings-repair-cooldown-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Repair cooldown</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Minimum wait time (in minutes) between repair runs for the same symbol. Off = use the environment default.
                  </p>
                </div>
                <NumericOverrideRow
                  fieldKey="repair-cooldown-minutes"
                  label="Cooldown"
                  override={config.repairCooldownMinutes}
                  effective={config.effectiveRepairCooldownMinutes}
                  bounds={config.bounds.repairCooldownMinutes}
                  unit="min"
                  onSave={(v) => patchAppConfigField("repairCooldownMinutes", v)}
                />
              </div>
            </Card>
            <Card data-testid="admin-settings-backfill-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Backfill</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Retry budget and rate-limit backoff for the FinMind/Yahoo backfill worker.
                  </p>
                </div>
                <NumericOverrideRow
                  fieldKey="backfill-retry-limit"
                  label="Retry limit"
                  description="Maximum pg-boss retry attempts per backfill job before it is marked failed."
                  override={config.backfillRetryLimit}
                  effective={config.effectiveBackfillRetryLimit}
                  bounds={config.bounds.backfillRetryLimit}
                  unit="attempts"
                  onSave={(v) => patchAppConfigField("backfillRetryLimit", v)}
                />
                <NumericOverrideRow
                  fieldKey="backfill-retry-delay-seconds"
                  label="Retry delay"
                  description="Base backoff between failed retries. The reschedule path additionally honours provider Retry-After."
                  override={config.backfillRetryDelaySeconds}
                  effective={config.effectiveBackfillRetryDelaySeconds}
                  bounds={config.bounds.backfillRetryDelaySeconds}
                  unit="s"
                  onSave={(v) => patchAppConfigField("backfillRetryDelaySeconds", v)}
                />
                <NumericOverrideRow
                  fieldKey="backfill-finmind-402-retry-ms"
                  label="FinMind 402 retry"
                  description="Pause window after FinMind returns HTTP 402 (quota exceeded) before resuming the queue."
                  override={config.backfillFinmind402RetryMs}
                  effective={config.effectiveBackfillFinmind402RetryMs}
                  bounds={config.bounds.backfillFinmind402RetryMs}
                  unit="ms"
                  onSave={(v) => patchAppConfigField("backfillFinmind402RetryMs", v)}
                />
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ── Catalog & metadata tab (Metadata enrichment mode) ─────────── */}
        <TabsContent value="catalog-metadata" data-testid="admin-settings-panel-catalog-metadata">
          <div className="space-y-6">
            {/* KZO-195 Tier-2 absence-based delisting detection (surfaced in
                KZO-199 Phase 4 — DTO + PATCH already in place since KZO-195;
                this surfaces them as admin-tunable rows). */}
            <Card data-testid="admin-settings-catalog-absence-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Absence-based delisting detection</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Thresholds that govern when a catalog instrument is auto-flagged as delisted.
                    Off = use the environment defaults.
                  </p>
                </div>
                <NumericOverrideRow
                  fieldKey="catalogAbsenceThreshold"
                  label="Absence threshold"
                  description="Number of consecutive catalog-sync runs an instrument must be absent before being flagged delisted."
                  override={config.catalogAbsenceThreshold}
                  effective={config.effectiveCatalogAbsenceThreshold}
                  bounds={config.bounds.catalogAbsenceThreshold}
                  unit="runs"
                  inputTestId="admin-settings-input-catalogAbsenceThreshold"
                  onSave={(v) => patchAppConfigField("catalogAbsenceThreshold", v)}
                />
                <NumericOverrideRow
                  fieldKey="catalogAbsenceGuardPercent"
                  label="Absence guard · percent"
                  description="Reject a catalog-sync diff that would mark more than this percent of the universe absent in a single run."
                  override={config.catalogAbsenceGuardPercent}
                  effective={config.effectiveCatalogAbsenceGuardPercent}
                  bounds={config.bounds.catalogAbsenceGuardPercent}
                  unit="%"
                  inputTestId="admin-settings-input-catalogAbsenceGuardPercent"
                  onSave={(v) => patchAppConfigField("catalogAbsenceGuardPercent", v)}
                />
                <NumericOverrideRow
                  fieldKey="catalogAbsenceGuardFloor"
                  label="Absence guard · floor"
                  description="Minimum absent-row count below which the percent guard does not engage (small universes are forgiving)."
                  override={config.catalogAbsenceGuardFloor}
                  effective={config.effectiveCatalogAbsenceGuardFloor}
                  bounds={config.bounds.catalogAbsenceGuardFloor}
                  unit="rows"
                  inputTestId="admin-settings-input-catalogAbsenceGuardFloor"
                  onSave={(v) => patchAppConfigField("catalogAbsenceGuardFloor", v)}
                />
              </div>
            </Card>

            <Card data-testid="admin-settings-metadata-enrichment-mode-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Metadata enrichment mode</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Controls whether AU instrument metadata (name, type) is enriched on every backfill or
                  only on user-driven triggers. Use {`"Skip on daily refresh"`} to conserve the Yahoo
                  budget when the daily-refresh cron sweeps every monitored ticker.
                </p>
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-slate-700"
                  htmlFor="admin-settings-metadata-enrichment-mode-select"
                >
                  Mode
                </label>
                <select
                  id="admin-settings-metadata-enrichment-mode-select"
                  value={metadataEnrichmentMode}
                  onChange={(e) => {
                    setMetadataEnrichmentMode(e.target.value);
                    setMetadataModeError(null);
                    setMetadataModeSuccess(null);
                  }}
                  disabled={metadataModeSaving}
                  className="mt-1 w-72 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  data-testid="admin-settings-metadata-enrichment-mode-select"
                >
                  <option value="">
                    Use environment default ({config.effectiveMetadataEnrichmentMode})
                  </option>
                  <option value="unconditional">Always enrich (unconditional)</option>
                  <option value="conditional">Skip on daily refresh (conditional)</option>
                </select>
                <p
                  className="mt-2 text-xs text-slate-500"
                  data-testid="admin-settings-metadata-enrichment-mode-effective"
                >
                  Effective: {config.effectiveMetadataEnrichmentMode}
                  {config.metadataEnrichmentMode === null ? " (env default)" : " (admin override)"}
                </p>
              </div>

              {metadataModeError && (
                <p
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                  data-testid="admin-settings-metadata-enrichment-mode-error"
                >
                  {metadataModeError}
                </p>
              )}

              {metadataModeSuccess && (
                <p
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                  role="status"
                  data-testid="admin-settings-metadata-enrichment-mode-success"
                >
                  {metadataModeSuccess}
                </p>
              )}

                <div className="flex items-center justify-end">
                  <Button
                    onClick={() => void handleSaveMetadataMode()}
                    disabled={metadataModeSaving}
                    data-testid="admin-settings-metadata-enrichment-mode-save"
                  >
                    {metadataModeSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ── Display defaults tab (Dashboard Timeframe Defaults) ────────── */}
        <TabsContent value="display-defaults" data-testid="admin-settings-panel-display-defaults">
          {/* ── KZO-159: Dashboard Timeframe Defaults section ─────────────── */}
          <Card data-testid="timeframe-defaults-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Dashboard Timeframe Defaults</h2>
                <p className="mt-1 text-sm text-slate-600">{TIMEFRAME_HELPER_TEXT}</p>
              </div>
    
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Active timeframes
                </p>
                {pendingRanges.length === 0 ? (
                  <p className="text-sm text-slate-500">No active timeframes — add at least one.</p>
                ) : (
                  // KZO-161 (158C) F4a: dnd-kit retrofit. Drop-in replacement for
                  // the ↑/↓ arrow buttons — `timeframe-chip-{range}` testid is
                  // preserved (referenced by `[timeframe-A..J]`); `-up/-down` are
                  // intentionally dropped (no dnd-kit boundary-disabled concept).
                  // Remove-from-active happens via a click on the chip itself
                  // (SortableRangeList renders the chip as a button when
                  // `onToggleVisibility` is provided). `toggleTestId` is
                  // intentionally omitted — admin has one toggle affordance, the
                  // chip; the popover variant adds a second dedicated button.
                  <SortableRangeList
                    rows={pendingRanges.map<SortableRangeRow>((range) => ({
                      range,
                      active: true,
                      disabled: timeframeSaving,
                    }))}
                    onReorder={reorderChips}
                    onToggleVisibility={(range) => toggleChip(range)}
                    dragHandleTestId={(r) => `timeframe-drag-handle-${r}`}
                    chipTestId={(r) => `timeframe-chip-${r}`}
                    toggleLabel={(r) => `Remove ${r} from active timeframes`}
                  />
                )}
              </div>
    
              {availablePredefinedChips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Available
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availablePredefinedChips.map((range) => (
                      <button
                        key={range}
                        type="button"
                        aria-label={`Add ${range} to active timeframes`}
                        onClick={() => toggleChip(range)}
                        disabled={timeframeSaving}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid={`timeframe-chip-${range}`}
                        data-active="false"
                      >
                        + {range}
                      </button>
                    ))}
                  </div>
                </div>
              )}
    
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="timeframe-add-input">
                  Add custom range
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="timeframe-add-input"
                    type="text"
                    value={customInput}
                    onChange={(e) => {
                      setCustomInput(e.target.value);
                      clearTimeframeFeedback();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canAddCustom) {
                        e.preventDefault();
                        handleAddCustom();
                      }
                    }}
                    disabled={timeframeSaving}
                    placeholder="e.g. 5Y, 18M, ALL"
                    className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    data-testid="timeframe-add-input"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAddCustom}
                    disabled={!canAddCustom}
                    data-testid="timeframe-add-button"
                  >
                    Add
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Format: {`{n}M`}, {`{n}Y`}, YTD, or ALL. Months ≤ 240, years ≤ 50.
                </p>
              </div>
    
              {displayedTimeframeError && (
                <p
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                  data-testid="timeframe-validation-error"
                >
                  {displayedTimeframeError}
                </p>
              )}
    
              {timeframeSaveSuccess && (
                <p
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                  role="status"
                  data-testid="timeframe-save-success"
                >
                  {timeframeSaveSuccess}
                </p>
              )}
    
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleResetTimeframes()}
                  disabled={timeframeSaving}
                  data-testid="timeframe-reset-button"
                >
                  Reset to defaults
                </Button>
                <Button
                  onClick={() => void handleSaveTimeframes()}
                  disabled={!canSaveTimeframes}
                  data-testid="timeframe-save-button"
                >
                  {timeframeSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── API keys tab (Provider API keys) ────────────────────────────── */}
        <TabsContent value="api-keys" data-testid="admin-settings-panel-api-keys">
          {/* ── KZO-198: Provider Keys section (Tier 0 — masked) ─────────── */}
          <Card data-testid="admin-settings-provider-keys-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Provider API keys</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Encrypted secrets stored in <code>app_config</code>. Existing values are never displayed; rotate to replace, clear to fall back to the environment value. Audit log records the rotation event but never the secret.
                </p>
              </div>
              <MaskedSecretInput
                fieldKey="finmind-api-token"
                label="FinMind API token"
                description="Bearer token used by the TWSE/FinMind data provider."
                isSet={config.finmindApiTokenSet}
                secretLengthBounds={config.secretLengthBounds}
                onRotate={(plaintext) => patchAppConfigField("finmindApiToken", plaintext)}
                onClear={() => patchAppConfigField("finmindApiToken", null)}
              />
              <MaskedSecretInput
                fieldKey="twelve-data-api-key"
                label="Twelve Data API key"
                description="API key used by the AU catalog (Twelve Data) provider."
                isSet={config.twelveDataApiKeySet}
                secretLengthBounds={config.secretLengthBounds}
                onRotate={(plaintext) => patchAppConfigField("twelveDataApiKey", plaintext)}
                onClear={() => patchAppConfigField("twelveDataApiKey", null)}
              />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="mcp" data-testid="admin-settings-panel-mcp">
          <AdminMcpSettingsPanel active={activeTab === "mcp"} />
        </TabsContent>
          </div>
        </div>
      </TabsRoot>

      <p className="text-xs text-slate-500" data-testid="admin-settings-last-updated">
        Last updated {formatTimestamp(config.updatedAt)} · Change will be recorded in the audit log
      </p>
    </div>
  );
}
