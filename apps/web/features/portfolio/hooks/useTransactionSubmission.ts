"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveErrorMessage } from "../../../lib/utils";
import type { TransactionInput } from "../../../components/portfolio/types";
import {
  estimateTransaction,
  fetchMarketDataPrice,
  submitTransaction,
  type MarketDataPriceResponse,
  type TransactionEstimateResponse,
} from "../services/portfolioService";

interface UseTransactionSubmissionOptions {
  initialValue: TransactionInput;
  noAccountsMessage: string;
  tickerRequiredMessage: string;
  successMessage: string;
  refresh: () => Promise<void>;
}

export interface TransactionPriceHint {
  date: string;
  message: MarketDataPriceResponse["match"];
  reason?: MarketDataPriceResponse["reason"];
}

interface CachedPriceLookup {
  expiresAt: number;
  response: MarketDataPriceResponse;
}

const PRICE_CACHE_TTL_MS = 60_000;
const LOOKUP_DEBOUNCE_MS = 400;

export function useTransactionSubmission({
  initialValue,
  noAccountsMessage,
  tickerRequiredMessage,
  successMessage,
  refresh,
}: UseTransactionSubmissionOptions) {
  const [draftTransaction, setDraftTransaction] = useState<TransactionInput>(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [priceHint, setPriceHint] = useState<TransactionPriceHint | null>(null);
  const [showPriceUnavailableHint, setShowPriceUnavailableHint] = useState(false);
  const [feeEstimate, setFeeEstimate] = useState<TransactionEstimateResponse | null>(null);

  const blockedEstimateKeyRef = useRef<string | null>(null);
  const hasUserEditedUnitPriceRef = useRef(false);
  const previousLookupKeyRef = useRef<string | null>(null);
  const priceCacheRef = useRef(new Map<string, CachedPriceLookup>());

  const applyAutoUnitPrice = useCallback((unitPrice: number) => {
    setDraftTransaction((current) => (current.unitPrice === unitPrice ? current : { ...current, unitPrice }));
  }, []);

  useEffect(() => {
    hasUserEditedUnitPriceRef.current = false;
  }, [draftTransaction.ticker, draftTransaction.tradeDate]);

  useEffect(() => {
    if (draftTransaction.type !== "BUY" || draftTransaction.taxAmount === undefined) {
      return;
    }
    setDraftTransaction((current) => ({ ...current, taxAmount: undefined }));
  }, [draftTransaction.taxAmount, draftTransaction.type]);

  useEffect(() => {
    const normalizedTicker = draftTransaction.ticker.trim().toUpperCase();
    const lookupKey = normalizedTicker && draftTransaction.tradeDate
      ? `${normalizedTicker}|${draftTransaction.tradeDate}`
      : null;
    const lookupKeyChanged = lookupKey !== previousLookupKeyRef.current;
    previousLookupKeyRef.current = lookupKey;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      if (!lookupKey) {
        setPriceHint(null);
        setShowPriceUnavailableHint(false);
        setFeeEstimate(null);
        blockedEstimateKeyRef.current = null;
        return;
      }

      let skipEstimate = false;

      if (lookupKeyChanged && !hasUserEditedUnitPriceRef.current) {
        try {
          const cached = priceCacheRef.current.get(lookupKey);
          const cachedResponse =
            cached && cached.expiresAt > Date.now()
              ? cached.response
              : await fetchMarketDataPrice(normalizedTicker, draftTransaction.tradeDate, controller.signal);

          if (controller.signal.aborted) return;

          if (!cached || cached.expiresAt <= Date.now()) {
            priceCacheRef.current.set(lookupKey, {
              expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
              response: cachedResponse,
            });
          }

          setPriceHint({
            date: cachedResponse.date,
            message: cachedResponse.match,
            reason: cachedResponse.reason,
          });
          setShowPriceUnavailableHint(false);
          blockedEstimateKeyRef.current = null;

          if (draftTransaction.unitPrice !== cachedResponse.close) {
            setFeeEstimate(null);
            applyAutoUnitPrice(cachedResponse.close);
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
          setPriceHint(null);
          setShowPriceUnavailableHint(true);
          setFeeEstimate(null);
          blockedEstimateKeyRef.current = lookupKey;
          skipEstimate = true;
        }
      }

      if (skipEstimate) {
        return;
      }

      if (
        blockedEstimateKeyRef.current === lookupKey &&
        !hasUserEditedUnitPriceRef.current
      ) {
        return;
      }

      if (
        draftTransaction.unitPrice <= 0 ||
        draftTransaction.quantity <= 0 ||
        !draftTransaction.accountId
      ) {
        setFeeEstimate(null);
        return;
      }

      try {
        const estimate = await estimateTransaction(
          {
            ticker: normalizedTicker,
            quantity: draftTransaction.quantity,
            unitPrice: draftTransaction.unitPrice,
            type: draftTransaction.type,
            isDayTrade: draftTransaction.isDayTrade,
            accountId: draftTransaction.accountId,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setFeeEstimate(estimate);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setFeeEstimate(null);
      }
    }, LOOKUP_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    applyAutoUnitPrice,
    draftTransaction.accountId,
    draftTransaction.isDayTrade,
    draftTransaction.quantity,
    draftTransaction.ticker,
    draftTransaction.tradeDate,
    draftTransaction.type,
    draftTransaction.unitPrice,
  ]);

  const submit = useCallback(async () => {
    if (!draftTransaction.accountId) {
      setMessage("");
      setErrorMessage(noAccountsMessage);
      return;
    }

    if (!draftTransaction.ticker.trim()) {
      setMessage("");
      setErrorMessage(tickerRequiredMessage);
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    setErrorMessage("");

    try {
      await submitTransaction(draftTransaction);
      await refresh();
      setMessage(successMessage);
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [draftTransaction, noAccountsMessage, refresh, successMessage, tickerRequiredMessage]);

  const markUnitPriceEdited = useCallback(() => {
    hasUserEditedUnitPriceRef.current = true;
    blockedEstimateKeyRef.current = null;
  }, []);

  return {
    draftTransaction,
    setDraftTransaction,
    markUnitPriceEdited,
    isSubmitting,
    message,
    setMessage,
    errorMessage,
    setErrorMessage,
    submit,
    priceHint,
    showPriceUnavailableHint,
    feeEstimate,
  };
}
