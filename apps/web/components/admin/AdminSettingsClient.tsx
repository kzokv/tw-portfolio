"use client";

// Validation strategy: client-side inline validation (see `admin-settings-validation-error`)
// blocks Save when the override is ON and the value is outside 1–10080 / non-integer / empty.
// A server 400 (defense-in-depth) is surfaced in the same error slot.

import { useState } from "react";
import type { AppConfigDto } from "@tw-portfolio/shared-types";
import { patchJson, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface AdminSettingsClientProps {
  initial: AppConfigDto;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 10080;

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function validateMinutesInput(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { value: null, error: "Enter a number between 1 and 10080." };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { value: null, error: "Value must be a whole number." };
  }
  if (num < MIN_MINUTES || num > MAX_MINUTES) {
    return { value: null, error: `Value must be between ${MIN_MINUTES} and ${MAX_MINUTES}.` };
  }
  return { value: num, error: null };
}

export function AdminSettingsClient({ initial }: AdminSettingsClientProps) {
  const [config, setConfig] = useState<AppConfigDto>(initial);
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(initial.repairCooldownMinutes !== null);
  const [minutesInput, setMinutesInput] = useState<string>(
    initial.repairCooldownMinutes !== null ? String(initial.repairCooldownMinutes) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const clientValidation = overrideEnabled ? validateMinutesInput(minutesInput) : { value: null, error: null };
  const inlineError = overrideEnabled ? clientValidation.error : null;

  const canSave = !saving && (!overrideEnabled || clientValidation.error === null);

  function handleToggle(next: boolean) {
    setOverrideEnabled(next);
    setSaveError(null);
    setSaveSuccess(null);
    if (next && minutesInput.trim() === "") {
      setMinutesInput(String(config.effectiveRepairCooldownMinutes));
    }
  }

  async function handleSave() {
    setSaveError(null);
    setSaveSuccess(null);

    const payloadValue: number | null = overrideEnabled ? clientValidation.value : null;
    if (overrideEnabled && payloadValue === null) {
      // Client validation failed — Save button is already disabled, but guard defensively.
      return;
    }

    setSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", { repairCooldownMinutes: payloadValue });
      setConfig(updated);
      setOverrideEnabled(updated.repairCooldownMinutes !== null);
      setMinutesInput(updated.repairCooldownMinutes !== null ? String(updated.repairCooldownMinutes) : "");
      setSaveSuccess("Settings saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(err.message);
      } else if (err instanceof Error) {
        setSaveError(err.message);
      } else {
        setSaveError("Failed to save settings.");
      }
    } finally {
      setSaving(false);
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

      {saveError && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
          data-testid="admin-settings-save-error"
        >
          {saveError}
          <button
            type="button"
            className="ml-2 text-red-500 hover:text-red-700"
            onClick={() => setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {saveSuccess && (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          role="status"
          data-testid="admin-settings-save-success"
        >
          {saveSuccess}
        </div>
      )}

      <Card>
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Repair cooldown</h2>
            <p className="mt-1 text-sm text-slate-600">
              Minimum wait time (in minutes) between repair runs for the same symbol. Off = use the environment default.
            </p>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={overrideEnabled}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
              data-testid="admin-settings-override-toggle"
            />
            <span className="text-sm font-medium text-slate-700">Override repair cooldown</span>
          </label>

          {overrideEnabled ? (
            <div>
              <label className="block text-sm font-medium text-slate-700">Cooldown (minutes)</label>
              <input
                type="number"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={1}
                value={minutesInput}
                onChange={(e) => {
                  setMinutesInput(e.target.value);
                  setSaveError(null);
                  setSaveSuccess(null);
                }}
                disabled={saving}
                className="mt-1 w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                data-testid="admin-settings-minutes-input"
              />
              <p className="mt-1 text-xs text-slate-500">Allowed range: {MIN_MINUTES}–{MAX_MINUTES} minutes.</p>
              {inlineError && (
                <p
                  className="mt-2 text-sm text-red-600"
                  role="alert"
                  data-testid="admin-settings-validation-error"
                >
                  {inlineError}
                </p>
              )}
            </div>
          ) : (
            <div>
              <span
                className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
                data-testid="admin-settings-env-default-badge"
              >
                Using env default · {config.effectiveRepairCooldownMinutes} min
              </span>
            </div>
          )}

          <div className="flex items-center justify-end">
            <Button
              onClick={() => void handleSave()}
              disabled={!canSave}
              data-testid="admin-settings-save-button"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Card>

      <p className="text-xs text-slate-500" data-testid="admin-settings-last-updated">
        Last updated {formatTimestamp(config.updatedAt)} · Change will be recorded in the audit log
      </p>
    </div>
  );
}
