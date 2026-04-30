"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../lib/api";
import {
  estimateFxTransfer,
  type FxTransferEstimate,
  type FxTransferInput,
} from "../services/fxTransferService";

interface UseFxTransferEstimateResult {
  estimate: FxTransferEstimate | null;
  loading: boolean;
  error: string;
  hardBlocked: boolean;
}

function hasCompleteInput(input: FxTransferInput): boolean {
  return (
    Boolean(input.fromAccountId) &&
    Boolean(input.toAccountId) &&
    Boolean(input.entryDate) &&
    input.fromAmount > 0 &&
    input.toAmount > 0 &&
    input.effectiveRate > 0
  );
}

export function useFxTransferEstimate(input: FxTransferInput): UseFxTransferEstimateResult {
  const [estimate, setEstimate] = useState<FxTransferEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const key = useMemo(() => JSON.stringify(input), [input]);
  const inputComplete = hasCompleteInput(input);

  useEffect(() => {
    const parsed = JSON.parse(key) as FxTransferInput;
    if (!hasCompleteInput(parsed)) {
      setEstimate(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      estimateFxTransfer(parsed, controller.signal)
        .then((next) => {
          setEstimate(next);
          setError("");
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setEstimate(null);
          setError(cause instanceof ApiError ? cause.message : "Could not estimate this FX transfer.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [key]);

  // Treat "complete input but no fresh estimate yet" as a soft block so the
  // submit button does not let the user race ahead of the server's
  // tolerance + balance checks. Transient between debounce ticks; cleared as
  // soon as the next estimate resolves.
  const missingEstimate = inputComplete && estimate === null;

  return {
    estimate,
    loading,
    error,
    hardBlocked:
      estimate?.toleranceState === "block"
      || estimate?.insufficientBalance === true
      || missingEstimate,
  };
}
