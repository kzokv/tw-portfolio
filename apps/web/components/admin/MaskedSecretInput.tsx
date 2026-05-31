"use client";

// KZO-198 Tier 0 masked-secret input. The existing value is NEVER displayed —
// the UI shows `••••••••` regardless of whether the secret is set or not. Two
// affordances:
//   - "Rotate" → opens a modal with a password-style input + length validation
//     (20–500 chars). Submit calls `onRotate(plaintext)` which PATCHes the new
//     value through the parent.
//   - "Clear" → confirm dialog → `onClear()` PATCHes `null` to remove the
//     override and fall back to the env value.
//
// Per `.claude/rules/nextjs-i18n-serialization.md` no inline function values
// crossing server→client boundary — all helper labels are string templates.

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "./ConfirmDialog";

// KZO-198 — Tier 0 plaintext length bounds default. Real call sites pass
// `config.secretLengthBounds` from the DTO (single source of truth in
// `apps/api/src/services/appConfig/bounds.ts:APP_CONFIG_SECRET_LENGTH`); the
// default here only exists for back-compat with legacy callers / tests.
const DEFAULT_SECRET_LENGTH_BOUNDS = { min: 20, max: 500 } as const;

interface MaskedSecretInputProps {
  /** Stable key used to derive child testids (e.g. `finmind-token`). */
  fieldKey: string;
  /** Visible label shown above the masked display. */
  label: string;
  /** Helper sentence under the label. */
  description?: string;
  /** Whether a value is currently stored (surface "Set" / "Not set" badge). */
  isSet: boolean;
  /** Async rotate handler. Throws → component surfaces the error. */
  onRotate: (plaintext: string) => Promise<void>;
  /** Async clear handler. Throws → component surfaces the error. */
  onClear: () => Promise<void>;
  /** Disable interactions while a peer save is in flight. */
  disabled?: boolean;
  /** Optional client-side generator for secret values. */
  onGenerateValue?: () => string;
  /** Label for the optional generator button. */
  generateLabel?: string;
  /**
   * Plaintext length window. Defaults to `{ min: 20, max: 500 }` for
   * back-compat. Real call sites should pass `config.secretLengthBounds`
   * from the DTO so the bound stays in sync with `bounds.ts`.
   */
  secretLengthBounds?: { min: number; max: number };
}

interface RotateModalProps {
  open: boolean;
  fieldLabel: string;
  testIdPrefix: string;
  bounds: { min: number; max: number };
  generateLabel?: string;
  onGenerateValue?: () => string;
  onSubmit: (plaintext: string) => Promise<void>;
  onCancel: () => void;
}

function RotateModal({
  open,
  fieldLabel,
  testIdPrefix,
  bounds,
  generateLabel,
  onGenerateValue,
  onSubmit,
  onCancel,
}: RotateModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setValue("");
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const trimmed = value;
  const lengthError =
    trimmed.length === 0
      ? null
      : trimmed.length < bounds.min
        ? `Value must be at least ${bounds.min} characters.`
        : trimmed.length > bounds.max
          ? `Value must be at most ${bounds.max} characters.`
          : null;
  const canSubmit = !submitting && trimmed.length >= bounds.min && trimmed.length <= bounds.max;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate secret.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleGenerate() {
    if (!onGenerateValue) return;
    try {
      setValue(onGenerateValue());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate secret.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="m-auto max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_20px_60px_rgba(15,23,42,0.2)] backdrop:bg-slate-950/40"
      data-testid={`${testIdPrefix}-rotate-dialog`}
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold text-slate-900">Rotate {fieldLabel}</h2>
        <p className="mt-2 text-sm text-slate-600">
          Paste the new secret. The existing value is never shown and will be replaced once you save.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label
            className="block text-sm font-medium text-slate-700"
            htmlFor={`${testIdPrefix}-rotate-input`}
          >
            New value
          </label>
          {onGenerateValue ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={submitting}
              data-testid={`${testIdPrefix}-generate-button`}
            >
              {generateLabel ?? "Generate"}
            </Button>
          ) : null}
        </div>
        <input
          id={`${testIdPrefix}-rotate-input`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          disabled={submitting}
          placeholder={`Min ${bounds.min}, max ${bounds.max} characters`}
          className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          data-testid={`${testIdPrefix}-rotate-input`}
        />
        <p className="mt-1 text-xs text-slate-500">
          Length: {trimmed.length} / {bounds.max}
        </p>

        {lengthError && (
          <p
            className="mt-2 text-sm text-red-600"
            role="alert"
            data-testid={`${testIdPrefix}-rotate-validation-error`}
          >
            {lengthError}
          </p>
        )}

        {error && (
          <p
            className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
            data-testid={`${testIdPrefix}-rotate-server-error`}
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
            data-testid={`${testIdPrefix}-rotate-cancel`}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            data-testid={`${testIdPrefix}-rotate-submit`}
          >
            {submitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

export function MaskedSecretInput({
  fieldKey,
  label,
  description,
  isSet,
  onRotate,
  onClear,
  disabled = false,
  onGenerateValue,
  generateLabel,
  secretLengthBounds = DEFAULT_SECRET_LENGTH_BOUNDS,
}: MaskedSecretInputProps) {
  const testIdPrefix = `admin-settings-${fieldKey}`;
  const [rotateOpen, setRotateOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function handleRotate(plaintext: string) {
    setStatusError(null);
    await onRotate(plaintext);
    setRotateOpen(false);
  }

  async function handleClear() {
    setStatusError(null);
    setClearing(true);
    try {
      await onClear();
      setClearOpen(false);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to clear secret.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-row`}>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span
          className="inline-flex select-none items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm tracking-widest text-slate-500"
          data-testid={`${testIdPrefix}-mask`}
          aria-label={`${label} value (masked)`}
        >
          ••••••••
        </span>
        <span
          className={
            isSet
              ? "inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
              : "inline-flex items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
          }
          data-testid={`${testIdPrefix}-status`}
        >
          {isSet ? "Set" : "Not set (using env default)"}
        </span>
      </div>

      {statusError && (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
          data-testid={`${testIdPrefix}-error`}
        >
          {statusError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() => setRotateOpen(true)}
          disabled={disabled}
          data-testid={`${testIdPrefix}-rotate-button`}
        >
          Rotate
        </Button>
        {isSet && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setClearOpen(true)}
            disabled={disabled || clearing}
            data-testid={`${testIdPrefix}-clear-button`}
          >
            Clear
          </Button>
        )}
      </div>

      <RotateModal
        open={rotateOpen}
        fieldLabel={label}
        testIdPrefix={testIdPrefix}
        bounds={secretLengthBounds}
        generateLabel={generateLabel}
        onGenerateValue={onGenerateValue}
        onSubmit={handleRotate}
        onCancel={() => setRotateOpen(false)}
      />

      <ConfirmDialog
        open={clearOpen}
        title={`Clear ${label}?`}
        description={`The override will be removed and the system will fall back to the environment-provided ${label}.`}
        confirmLabel="Clear"
        variant="danger"
        loading={clearing}
        dialogTestId={`${testIdPrefix}-clear-dialog`}
        confirmTestId={`${testIdPrefix}-clear-confirm`}
        cancelTestId={`${testIdPrefix}-clear-cancel`}
        onConfirm={() => void handleClear()}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
