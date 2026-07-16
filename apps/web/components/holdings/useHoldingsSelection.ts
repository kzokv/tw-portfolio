"use client";

import { useEffect, useMemo, useState } from "react";
import type { HoldingsSelectionPreferenceDto } from "@vakwen/shared-types";
import {
  buildHoldingsTickerId,
  defaultHoldingsSelectionPreference,
  fetchHoldingsPreferences,
  persistHoldingsSelectionPreference,
} from "./holdingsPreferenceHelpers";

export interface HoldingsSelectionUniverseItem {
  marketCode: string;
  ticker: string;
  label: string;
  searchText?: string;
}

let cachedSelection: HoldingsSelectionPreferenceDto | null = null;
let hydratePromise: Promise<HoldingsSelectionPreferenceDto> | null = null;
const subscribers = new Set<(selection: HoldingsSelectionPreferenceDto) => void>();

function emitSelection(selection: HoldingsSelectionPreferenceDto): void {
  cachedSelection = selection;
  for (const subscriber of subscribers) {
    subscriber(selection);
  }
}

async function ensureSelectionHydrated(force = false): Promise<HoldingsSelectionPreferenceDto> {
  if (!force && cachedSelection) return cachedSelection;
  if (!force && hydratePromise) return hydratePromise;
  hydratePromise = fetchHoldingsPreferences()
    .then((response) => {
      emitSelection(response.holdingsSelection);
      hydratePromise = null;
      return response.holdingsSelection;
    })
    .catch(() => {
      const fallback = cachedSelection ?? defaultHoldingsSelectionPreference();
      emitSelection(fallback);
      hydratePromise = null;
      return fallback;
    });
  return hydratePromise;
}

function normalizeSelectionForPersist(tickerIds: string[]): HoldingsSelectionPreferenceDto {
  const dedupedTickerIds = [...new Set(tickerIds)].sort((left, right) => left.localeCompare(right));
  if (dedupedTickerIds.length === 0) {
    return defaultHoldingsSelectionPreference();
  }
  return {
    version: 1,
    mode: "custom",
    tickerIds: dedupedTickerIds,
  };
}

function buildTickerIdSet(selection: HoldingsSelectionPreferenceDto): Set<string> {
  return new Set(selection.mode === "custom" ? selection.tickerIds ?? [] : []);
}

export function useHoldingsSelection(universe: HoldingsSelectionUniverseItem[]) {
  const [selection, setSelection] = useState<HoldingsSelectionPreferenceDto>(
    () => cachedSelection ?? defaultHoldingsSelectionPreference(),
  );
  const [selectionError, setSelectionError] = useState("");
  const [isHydrated, setIsHydrated] = useState(cachedSelection !== null);

  useEffect(() => {
    const handleSelectionChange = (nextSelection: HoldingsSelectionPreferenceDto) => {
      setSelection(nextSelection);
      setIsHydrated(true);
    };
    subscribers.add(handleSelectionChange);
    void ensureSelectionHydrated().then(handleSelectionChange);
    return () => {
      subscribers.delete(handleSelectionChange);
    };
  }, []);

  const universeItems = useMemo(
    () => universe.map((item) => ({
      ...item,
      tickerId: buildHoldingsTickerId(item.marketCode, item.ticker),
      searchText: item.searchText ?? `${item.marketCode} ${item.ticker} ${item.label}`.toLowerCase(),
    })),
    [universe],
  );
  const universeTickerIds = useMemo(
    () => universeItems.map((item) => item.tickerId),
    [universeItems],
  );
  const universeTickerIdSet = useMemo(
    () => new Set(universeTickerIds),
    [universeTickerIds],
  );
  const selectedTickerIds = useMemo(
    () => selection.mode === "custom" ? [...new Set(selection.tickerIds ?? [])].sort((left, right) => left.localeCompare(right)) : [],
    [selection],
  );
  const selectedTickerIdSet = useMemo(
    () => buildTickerIdSet(selection),
    [selection],
  );
  const unavailableTickerIds = useMemo(
    () => selectedTickerIds.filter((tickerId) => !universeTickerIdSet.has(tickerId)),
    [selectedTickerIds, universeTickerIdSet],
  );
  const availableSelectedTickerIds = useMemo(
    () => selection.mode === "all"
      ? []
      : selectedTickerIds.filter((tickerId) => universeTickerIdSet.has(tickerId)),
    [selection.mode, selectedTickerIds, universeTickerIdSet],
  );

  function commit(nextSelection: HoldingsSelectionPreferenceDto): void {
    const previousSelection = selection;
    setSelection(nextSelection);
    emitSelection(nextSelection);
    setSelectionError("");
    void persistHoldingsSelectionPreference(nextSelection).catch((error) => {
      setSelection(previousSelection);
      emitSelection(previousSelection);
      setSelectionError(error instanceof Error ? error.message : String(error));
    });
  }

  function setAll(): void {
    commit(defaultHoldingsSelectionPreference());
  }

  function setCustomTickerIds(nextTickerIds: string[]): void {
    commit(normalizeSelectionForPersist(nextTickerIds));
  }

  function toggleTicker(tickerId: string): void {
    if (selection.mode === "all") {
      commit(normalizeSelectionForPersist([tickerId]));
      return;
    }
    const nextSelectedTickerIds = new Set(selectedTickerIds);
    if (nextSelectedTickerIds.has(tickerId)) {
      nextSelectedTickerIds.delete(tickerId);
    } else {
      nextSelectedTickerIds.add(tickerId);
    }
    commit(normalizeSelectionForPersist([...nextSelectedTickerIds]));
  }

  function removeTicker(tickerId: string): void {
    if (selection.mode !== "custom") return;
    commit(normalizeSelectionForPersist(selectedTickerIds.filter((currentTickerId) => currentTickerId !== tickerId)));
  }

  return {
    isHydrated,
    isAllSelected: selection.mode === "all",
    selectionMode: selection.mode,
    selectedTickerIds,
    selectedTickerIdSet,
    availableSelectedTickerIds,
    selectionError,
    unavailableTickerIds,
    universeItems,
    universeTickerIds,
    universeTickerIdSet,
    isTickerSelected: (tickerId: string) => selection.mode === "custom"
      && selectedTickerIdSet.has(tickerId),
    setAll,
    setCustomTickerIds,
    toggleTicker,
    removeTicker,
  };
}
