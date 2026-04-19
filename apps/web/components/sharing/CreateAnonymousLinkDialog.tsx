"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import { getDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";

interface CreateAnonymousLinkDialogProps {
  open: boolean;
  locale: LocaleCode;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (expiresInDays: number) => void;
  onOpenChange: (open: boolean) => void;
}

type Preset = "7" | "30" | "90" | "custom";

const PRESET_VALUES: Record<Exclude<Preset, "custom">, number> = {
  "7": 7,
  "30": 30,
  "90": 90,
};

export function CreateAnonymousLinkDialog({
  open,
  locale,
  isSubmitting,
  error,
  onSubmit,
  onOpenChange,
}: CreateAnonymousLinkDialogProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const copy = dict.sharing.publicLinks.createDialog;
  const [preset, setPreset] = useState<Preset>("30");
  const [customValue, setCustomValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreset("30");
    setCustomValue("");
    setValidationError(null);
  }, [open]);

  if (!open) return null;

  function resolveDays(): number | null {
    if (preset !== "custom") return PRESET_VALUES[preset];
    const trimmed = customValue.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(value) || value < 1 || value > 365) return null;
    return value;
  }

  function handleSubmit() {
    const days = resolveDays();
    if (days === null) {
      setValidationError(copy.customInvalid);
      return;
    }
    setValidationError(null);
    onSubmit(days);
  }

  const displayError = validationError ?? error;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/82" />
        <Dialog.Content
          className="glass-panel !fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-5 shadow-glass focus:outline-none sm:p-6"
          data-testid="create-public-link-dialog"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-slate-950">{copy.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600">{copy.description}</Dialog.Description>
            </div>
            <button
              type="button"
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={copy.cancelLabel}
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <fieldset className="mt-5 space-y-2" disabled={isSubmitting}>
            <legend className="text-sm font-medium text-slate-700">{copy.expiryLabel}</legend>

            {(
              [
                { value: "7" as const, label: copy.option7Days },
                { value: "30" as const, label: copy.option30Days, isDefault: true },
                { value: "90" as const, label: copy.option90Days },
              ]
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-white/80 px-4 py-2.5 text-sm text-slate-700 hover:bg-white"
              >
                <input
                  type="radio"
                  name="create-anon-link-expiry"
                  value={opt.value}
                  checked={preset === opt.value}
                  onChange={() => setPreset(opt.value)}
                  className="h-4 w-4"
                  data-testid={`create-public-link-expiry-${opt.value}`}
                />
                <span className="flex-1">{opt.label}</span>
                {opt.isDefault ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {copy.defaultBadge}
                  </span>
                ) : null}
              </label>
            ))}

            <label className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-white/80 px-4 py-2.5 text-sm text-slate-700 hover:bg-white">
              <input
                type="radio"
                name="create-anon-link-expiry"
                value="custom"
                checked={preset === "custom"}
                onChange={() => setPreset("custom")}
                className="h-4 w-4"
                data-testid="create-public-link-expiry-custom"
              />
              <span>{copy.optionCustom}</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={customValue}
                onFocus={() => setPreset("custom")}
                onChange={(event) => {
                  setPreset("custom");
                  setCustomValue(event.target.value);
                  setValidationError(null);
                }}
                placeholder={copy.customInputPlaceholder}
                className="ml-auto w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
                data-testid="create-public-link-expiry-custom-input"
              />
              <span className="text-xs text-slate-500">{copy.customInputSuffix}</span>
            </label>
          </fieldset>

          {displayError ? (
            <p
              className="mt-4 rounded-[16px] border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm text-rose-700"
              role="alert"
              data-testid="create-public-link-error"
            >
              {displayError}
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              data-testid="create-public-link-cancel"
            >
              {copy.cancelLabel}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              data-testid="create-public-link-submit"
            >
              {isSubmitting ? copy.submittingLabel : copy.submitLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
