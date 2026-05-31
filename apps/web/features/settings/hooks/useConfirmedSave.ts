"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveErrorMessage } from "../../../lib/utils";

export type ConfirmedSaveStatus = "idle" | "confirming" | "saving" | "saved" | "error";

interface UseConfirmedSaveOptions<TValue> {
  /**
   * The persistence call. Invoked AFTER the user clicks Save inside the
   * confirmation dialog (not on commit). Throw to surface a save error.
   */
  save: (value: TValue) => Promise<void>;
  /**
   * Optional validator. Returning a non-empty string blocks the dialog from
   * opening (or, if already open, blocks the Save button) and surfaces
   * inline `error`. Per Decision #13 — invalid input never reaches PATCH.
   */
  validate?: (value: TValue) => string | null;
  /** Called on a successful save. */
  onSaved?: (value: TValue) => void;
}

/**
 * Phase 3d S3 — sensitive-field confirmed save hook.
 *
 * Sensitive fields per Decision #12 / Phase 3 spec §3d include:
 * profile display-name + picture URL, account currency / fee-profile,
 * monitored-tickers add/remove (batch button), account delete/restore/purge.
 * Each of those uses its own confirmation modal; this hook offers a
 * shared shape so the call sites stay symmetric.
 *
 * Pattern:
 *   const save = useConfirmedSave({ save: persist, validate });
 *   <input value={draft} onChange={(e) => setDraft(e.target.value)} />
 *   <Button onClick={() => save.openConfirm(draft)}>Save</Button>
 *   <Dialog open={save.isConfirming} onOpenChange={save.cancel}>...
 *     <Button onClick={() => save.confirm()}>Confirm</Button>
 *   </Dialog>
 *
 * The hook intentionally does NOT render the dialog itself — call sites
 * render shadcn `Dialog` + `AlertDialog` with their own copy and test ids.
 */
export function useConfirmedSave<TValue>({
  save,
  validate,
  onSaved,
}: UseConfirmedSaveOptions<TValue>) {
  const [status, setStatus] = useState<ConfirmedSaveStatus>("idle");
  const [error, setError] = useState<string>("");
  const pendingValueRef = useRef<TValue | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openConfirm = useCallback(
    (value: TValue): boolean => {
      const validationError = validate?.(value) ?? null;
      if (validationError) {
        setError(validationError);
        setStatus("error");
        return false;
      }
      setError("");
      pendingValueRef.current = value;
      setStatus("confirming");
      return true;
    },
    [validate],
  );

  const cancel = useCallback(() => {
    if (!mountedRef.current) return;
    pendingValueRef.current = null;
    setStatus("idle");
    setError("");
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    const value = pendingValueRef.current;
    // No pending value — confirm was called without an openConfirm,
    // nothing to do. (Earlier `typeof value !== "object"` half of the
    // guard was dead code: `typeof null === "object"` in JS.)
    if (value === null) return;
    setStatus("saving");
    setError("");
    try {
      await save(value as TValue);
      if (!mountedRef.current) return;
      pendingValueRef.current = null;
      setStatus("saved");
      onSaved?.(value as TValue);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(resolveErrorMessage(err));
      setStatus("error");
    }
  }, [save, onSaved]);

  const reset = useCallback(() => {
    pendingValueRef.current = null;
    setError("");
    setStatus("idle");
  }, []);

  return {
    status,
    error,
    isConfirming: status === "confirming",
    isSaving: status === "saving",
    isSaved: status === "saved",
    hasError: status === "error",
    openConfirm,
    confirm,
    cancel,
    reset,
  };
}
