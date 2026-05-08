"use client";

// KZO-198 — shared numeric override row used by the admin sectioned form for
// every Tier 1 numeric field. Mirrors the established repair-cooldown UX:
// off = "use env default · {effective}" badge; on = numeric input bounded
// by `min`/`max` (read from the DTO bounds object — never duplicated in the
// web layer per `.claude/rules/config-web-env-pattern.md` parity); each row
// has its own Save and Reset-to-default actions.

import { useEffect, useState } from "react";
import { Button } from "../ui/Button";

interface NumericOverrideRowProps {
  /** Stable key used to derive testids (e.g. `market-data-price-window-ms`). */
  fieldKey: string;
  label: string;
  description?: string;
  /** Current override value or `null` (means "use env default"). */
  override: number | null;
  /** Fully-resolved value after admin → env fallback, displayed when override is off. */
  effective: number;
  /** Min/max range from `bounds.ts` (DTO carries these — UI must NOT duplicate). */
  bounds: { min: number; max: number };
  /** Optional unit suffix shown beside the input (e.g. "ms", "s", "min"). */
  unit?: string;
  /** Disabled while a peer save is in flight (one save at a time per page). */
  disabled?: boolean;
  /** PATCH the new value. `null` resets to env default. Throws on server error. */
  onSave: (next: number | null) => Promise<void>;
}

function validate(raw: string, bounds: { min: number; max: number }): {
  value: number | null;
  error: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { value: null, error: `Enter a number between ${bounds.min} and ${bounds.max}.` };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { value: null, error: "Value must be a whole number." };
  }
  if (num < bounds.min || num > bounds.max) {
    return {
      value: null,
      error: `Value must be between ${bounds.min} and ${bounds.max}.`,
    };
  }
  return { value: num, error: null };
}

export function NumericOverrideRow({
  fieldKey,
  label,
  description,
  override,
  effective,
  bounds,
  unit,
  disabled = false,
  onSave,
}: NumericOverrideRowProps) {
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(override !== null);
  const [input, setInput] = useState<string>(override !== null ? String(override) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Re-sync local UI state when the parent's DTO updates (e.g. after a Save
  // refreshes `config`).
  useEffect(() => {
    setOverrideEnabled(override !== null);
    setInput(override !== null ? String(override) : "");
  }, [override]);

  const validation = overrideEnabled ? validate(input, bounds) : { value: null, error: null };
  const inlineError = overrideEnabled ? validation.error : null;
  const canSave = !saving && !disabled && (!overrideEnabled || validation.error === null);

  function handleToggle(next: boolean) {
    setOverrideEnabled(next);
    setError(null);
    setSuccess(null);
    if (next && input.trim() === "") {
      setInput(String(effective));
    }
  }

  async function dispatchSave(next: number | null) {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await onSave(next);
      setSuccess("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!canSave) return;
    const next = overrideEnabled ? validation.value : null;
    if (overrideEnabled && next === null) return;
    await dispatchSave(next);
  }

  async function handleReset() {
    await dispatchSave(null);
  }

  const testIdPrefix = `admin-settings-${fieldKey}`;

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0" data-testid={`${testIdPrefix}-row`}>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={overrideEnabled}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={saving || disabled}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
          data-testid={`${testIdPrefix}-toggle`}
        />
        <span className="text-sm font-medium text-slate-700">Override</span>
      </label>

      {overrideEnabled ? (
        <div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={bounds.min}
              max={bounds.max}
              step={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
                setSuccess(null);
              }}
              disabled={saving || disabled}
              className="w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              data-testid={`${testIdPrefix}-input`}
            />
            {unit && <span className="text-xs text-slate-500">{unit}</span>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Allowed range: {bounds.min}–{bounds.max}
            {unit ? ` ${unit}` : ""}.
          </p>
          {inlineError && (
            <p
              className="mt-2 text-sm text-red-600"
              role="alert"
              data-testid={`${testIdPrefix}-validation-error`}
            >
              {inlineError}
            </p>
          )}
        </div>
      ) : (
        <span
          className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
          data-testid={`${testIdPrefix}-env-default-badge`}
        >
          Using env default · {effective}
          {unit ? ` ${unit}` : ""}
        </span>
      )}

      {error && (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
          data-testid={`${testIdPrefix}-error`}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          role="status"
          data-testid={`${testIdPrefix}-success`}
        >
          {success}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {override !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleReset()}
            disabled={saving || disabled}
            data-testid={`${testIdPrefix}-reset-button`}
          >
            Reset to default
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={!canSave}
          data-testid={`${testIdPrefix}-save-button`}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
