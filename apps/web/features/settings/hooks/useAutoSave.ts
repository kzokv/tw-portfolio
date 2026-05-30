"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveErrorMessage } from "../../../lib/utils";

const DEFAULT_DEBOUNCE_MS = 600;
const SAVED_FLASH_MS = 1800;

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutoSaveOptions<TValue> {
  /**
   * Persistence call — invoked with the latest committed value after the
   * debounce elapses. Throw to surface the value as `error` (the previous
   * persisted value remains the source of truth, per Decision #13).
   */
  save: (value: TValue) => Promise<void>;
  /**
   * Debounce window before `save()` fires after the last `commit(...)` call.
   * Defaults to 600ms (Decision #12 / Phase 3 spec §3d).
   */
  debounceMs?: number;
  /**
   * Optional validator. Returning a non-empty string blocks the save and
   * surfaces the message via `error`. The value stays in the optimistic UI
   * (callers keep showing the user's invalid edit) — per Decision #13
   * "previous valid value persists in DB until valid input is committed".
   */
  validate?: (value: TValue) => string | null;
  /** Called on a successful save (after the persisted value is committed). */
  onSaved?: (value: TValue) => void;
}

/**
 * Phase 3d S3 — debounced, optimistic-UI auto-save hook.
 *
 * Semantics:
 *   - `commit(value)` is the user-driven blur/change hook. It schedules a
 *     save after `debounceMs` of inactivity.
 *   - Optimistic UI is the caller's responsibility: the caller renders the
 *     in-flight value from its own state, and uses this hook's `status` /
 *     `error` for inline feedback.
 *   - Invalid input (per the optional `validate`) stays visible — `error`
 *     fires, no PATCH is sent, and the prior valid value stays persisted.
 *   - `flush()` exists for "save now" call sites (e.g. blur on a critical
 *     field) — bypasses the debounce, runs the save synchronously.
 *
 * Why no internal optimistic state mirror: each consumer (theme picker,
 * locale row, etc.) already has its own state with bespoke roll-back UX;
 * a one-size mirror inside the hook would conflict (and would have to
 * fight the consumer's setState lifecycle). Keep the hook narrow.
 *
 * `.claude/rules/react-useEventStream-preconnect-pattern.md` does NOT
 * apply here (no SSE coupling) — but the same "separate concerns"
 * principle motivates leaving optimistic state to the caller.
 */
export function useAutoSave<TValue>({
  save,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  validate,
  onSaved,
}: UseAutoSaveOptions<TValue>) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<TValue | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const runSave = useCallback(
    async (value: TValue) => {
      const validationError = validate?.(value) ?? null;
      if (validationError) {
        setError(validationError);
        setStatus("error");
        return;
      }
      setError("");
      setStatus("saving");
      try {
        await save(value);
        if (!mountedRef.current) return;
        setStatus("saved");
        onSaved?.(value);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          setStatus((current) => (current === "saved" ? "idle" : current));
        }, SAVED_FLASH_MS);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(resolveErrorMessage(err));
        setStatus("error");
      }
    },
    [save, validate, onSaved],
  );

  const commit = useCallback(
    (value: TValue) => {
      pendingValueRef.current = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const pending = pendingValueRef.current;
        pendingValueRef.current = null;
        // No pending value (unlikely — guard for race). Note: only check
        // `=== null`. `typeof null === "object"` in JS, so the earlier
        // belt-and-suspenders check was dead code; the intent is "skip if
        // we have no value to save."
        if (pending === null) return;
        void runSave(pending as TValue);
      }, debounceMs);
    },
    [debounceMs, runSave],
  );

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingValueRef.current;
    pendingValueRef.current = null;
    // No pending value — nothing to flush.
    if (pending === null) return;
    await runSave(pending as TValue);
  }, [runSave]);

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    pendingValueRef.current = null;
    setError("");
    setStatus("idle");
  }, []);

  return {
    status,
    error,
    commit,
    flush,
    reset,
    isSaving: status === "saving",
    isSaved: status === "saved",
    hasError: status === "error",
  };
}
