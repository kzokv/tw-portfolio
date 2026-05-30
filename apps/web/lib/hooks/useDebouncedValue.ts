"use client";

import { useEffect, useState } from "react";

/**
 * KZO-188 — Generic debounced-value hook. Re-emits `value` after `delayMs`
 * milliseconds of stillness. The pending timer is cleared on every value
 * change so consumers see only the trailing settled value.
 *
 * Caller owns abort semantics for any side effect that the debounced value
 * triggers — this hook intentionally does NOT manage `AbortController`.
 *
 * @example
 *   const debouncedQuery = useDebouncedValue(query, 300);
 *   useEffect(() => {
 *     if (debouncedQuery.length < 2) return;
 *     const ctrl = new AbortController();
 *     void search(debouncedQuery, ctrl.signal);
 *     return () => ctrl.abort();
 *   }, [debouncedQuery]);
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
