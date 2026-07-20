"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type {
  AdminMarketDataTableSettingsPreferenceDto,
  HoldingsSortDirection,
  HoldingsSortField,
  HoldingsSortMode,
  HoldingsTableContextPreferenceDto,
  HoldingsTableLayoutStyle,
  HoldingsTableSettingsPreferenceDto,
} from "@vakwen/shared-types";
import {
  adminMarketDataTableSettingsPreferenceSchema,
  HOLDINGS_SORT_FIELDS,
  holdingsTableSettingsPreferenceSchema,
} from "@vakwen/shared-types";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, GripVertical, ListOrdered, Minus, Plus, RotateCw, RotateCcw, Rows3, Settings2, X } from "lucide-react";
import { getJson, patchJson } from "../../lib/api";
import type { AppDictionary } from "../../lib/i18n/types";
import { cn } from "../../lib/utils";
import {
  canonicalizeHoldingsTableContextColumns,
  fetchHoldingsPreferences,
  persistHoldingsTableContexts,
  sanitizeHoldingsTableContextPatches,
  normalizeHoldingsSortPreference,
  resolveHoldingsTableContextPreference,
  type RuntimeHoldingsSortPreference,
} from "./holdingsPreferenceHelpers";
import { defaultHoldingsSortDirection } from "./holdingsSorting";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/shadcn/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/shadcn/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "../ui/shadcn/toggle-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/shadcn/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/shadcn/tooltip";

export type HoldingsColumnAlign = "left" | "right";

export interface HoldingsGridColumnDefinition<ColumnId extends string> {
  id: ColumnId;
  label: string;
  defaultWidth: number;
  canHide?: boolean;
  align?: HoldingsColumnAlign;
  sortField?: HoldingsSortField;
}

interface UserPreferencesResponse {
  preferences?: {
    holdingsTableSettings?: unknown;
    adminMarketDataTableSettings?: unknown;
  };
}

export interface HoldingsColumnSettingsCopy {
  columnSettingsButtonLabel: string;
  columnSettingsTitle: string;
  dragColumnTitle: string;
  dragRowTitle: string;
  layoutStyleLabel: string;
  layoutStyleCompact: string;
  layoutStyleDetailed: string;
  mobileSummaryCountLabel: string;
  mobileSummaryCountHelp: string;
  mobileSummaryCountDecreaseAria: string;
  mobileSummaryCountIncreaseAria: string;
  moveColumnLeftAria: string;
  moveColumnRightAria: string;
  moveRowUpAria: string;
  moveRowDownAria: string;
  resizeColumnAria: string;
  resetColumnsLabel: string;
  resetRowsLabel: string;
  rowSettingsButtonLabel: string;
  rowSettingsTitle: string;
  toggleColumnAria: string;
  topHoldingsLimitLabel: string;
  topHoldingsLimitDecreaseAria: string;
  topHoldingsLimitIncreaseAria: string;
  hiddenSortLabel: string;
  customSortLabel: string;
  mobileSortDirectionLabel: string;
  mobileSortDirectionUnavailableLabel: string;
  mobileSortFieldLabel: string;
  resetSortLabel: string;
  sortAscendingLabel: string;
  sortActionTooltip: string;
  sortDescendingLabel: string;
  sortTooltip: string;
}

type ColumnSettingsPreferenceNamespace = "holdingsTableSettings" | "adminMarketDataTableSettings";

export type HoldingsDefaultSort =
  | { sortDirection: HoldingsSortDirection; sortField: HoldingsSortField; sortMode: "field" }
  | { sortMode: "custom" };

export interface UseHoldingsColumnSettingsOptions<ColumnId extends string> {
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  contextKey: string;
  defaultLayoutStyle?: HoldingsTableLayoutStyle;
  defaultHiddenColumns?: ColumnId[];
  defaultMobileSummaryCount?: number;
  mobileSummaryColumnIds?: ColumnId[];
  pinnedLeadingColumns?: ColumnId[];
  preferenceNamespace?: ColumnSettingsPreferenceNamespace;
  defaultSort?: HoldingsDefaultSort;
  supportedSortFields?: HoldingsSortField[];
}

interface ColumnRuntimeSettings<ColumnId extends string> {
  columnOrder: ColumnId[];
  hiddenColumns: ColumnId[];
  columnWidths: Record<ColumnId, number>;
  layoutStyle: HoldingsTableLayoutStyle;
  mobileSummaryCount: number;
  rowOrder: string[];
  selectedMarketCodes: string[];
  selectedAccountIds: string[];
  topHoldingsLimit: number;
  sortDirection?: HoldingsSortDirection;
  sortField?: HoldingsSortField;
  sortMode?: HoldingsSortMode;
}

export interface HoldingsColumnSettingsState<ColumnId extends string> {
  allColumns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  orderedColumns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  pinnedLeadingColumns: ColumnId[];
  visibleColumns: ColumnId[];
  layoutStyle: HoldingsTableLayoutStyle;
  mobileSummaryCount: number;
  mobileSummaryCountMax: number;
  rowOrder: string[];
  selectedMarketCodes: string[];
  selectedAccountIds: string[];
  settingsError: string;
  topHoldingsLimit: number;
  sortDirection?: HoldingsSortDirection;
  sortField?: HoldingsSortField;
  sortMode?: HoldingsSortMode;
  getColumnWidth: (column: ColumnId) => number;
  headerProps: (column: ColumnId) => {
    draggable: true;
    onDragStart: (event: React.DragEvent<HTMLElement>) => void;
    onDragOver: (event: React.DragEvent<HTMLElement>) => void;
    onDrop: (event: React.DragEvent<HTMLElement>) => void;
  };
  moveColumn: (column: ColumnId, direction: "left" | "right") => void;
  resizeProps: (column: ColumnId) => {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  };
  resetColumns: () => void;
  resetRowOrder: () => void;
  setLayoutStyle: (style: HoldingsTableLayoutStyle) => void;
  setMobileSummaryCount: (count: number) => void;
  setRowOrder: (rowOrder: string[]) => void;
  setSelectedMarketCodes: (marketCodes: string[]) => void;
  setSelectedAccountIds: (accountIds: string[]) => void;
  setTopHoldingsLimit: (limit: number) => void;
  toggleColumn: (column: ColumnId) => void;
  resetSort?: () => void;
  setCustomSort?: () => void;
  setSort?: (field: HoldingsSortField, direction?: HoldingsSortDirection) => void;
}

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 420;
const MIN_TOP_HOLDINGS_LIMIT = 1;
const MAX_TOP_HOLDINGS_LIMIT = 100;
const DEFAULT_TOP_HOLDINGS_LIMIT = 12;
const EMPTY_DEFAULT_HIDDEN_COLUMNS: never[] = [];
const LEGACY_RUNTIME_COLUMN_IDS: Readonly<Record<string, readonly string[]>> = {
  actions: ["action"],
  allocation: ["weight"],
  averageCost: ["avgCost"],
  dailyChange: ["daily"],
  dataHealth: ["health"],
  lastDividendDate: ["lastDividend"],
  nextDividendDate: ["nextDividend"],
  unrealizedPnl: ["pnl", "unrealized"],
};
const HOLDINGS_SETTINGS_FALLBACK_COPY = {
  columnSettingsButtonLabel: "Columns",
  columnSettingsTitle: "Column settings",
  dragColumnTitle: "Drag to reorder {column}",
  layoutStyleLabel: "Table style",
  layoutStyleCompact: "Dashboard Top Holdings",
  layoutStyleDetailed: "Portfolio Holdings",
  mobileSummaryCountLabel: "Mobile summary fields",
  mobileSummaryCountHelp: "Choose how many ordered columns appear before Details.",
  mobileSummaryCountDecreaseAria: "Show fewer mobile summary fields",
  mobileSummaryCountIncreaseAria: "Show more mobile summary fields",
  rowSettingsButtonLabel: "Rows",
  rowSettingsTitle: "Row settings",
  dragRowTitle: "Drag to reorder {row}",
  moveRowUpAria: "Move {row} row up",
  moveRowDownAria: "Move {row} row down",
  resetRowsLabel: "Reset rows",
  topHoldingsLimitLabel: "Top holdings count",
  topHoldingsLimitDecreaseAria: "Show fewer top holdings",
  topHoldingsLimitIncreaseAria: "Show more top holdings",
  moveColumnLeftAria: "Move {column} column left",
  moveColumnRightAria: "Move {column} column right",
  resizeColumnAria: "Resize {column} column",
  resetColumnsLabel: "Reset",
  toggleColumnAria: "Show {column} column",
  hiddenSortLabel: "Sorted by {column} {direction}",
  customSortLabel: "Custom order",
  mobileSortDirectionLabel: "Change sort direction to {direction}",
  mobileSortDirectionUnavailableLabel: "Choose a sort field before changing direction",
  mobileSortFieldLabel: "Sort field",
  resetSortLabel: "Reset sort",
  sortAscendingLabel: "ascending",
  sortActionTooltip: "Sort {column} {direction}",
  sortDescendingLabel: "descending",
  sortTooltip: "{column} sorted {direction}",
} satisfies HoldingsColumnSettingsCopy;

export function useHoldingsColumnSettings<ColumnId extends string>({
  columns,
  contextKey,
  defaultLayoutStyle = "portfolio",
  defaultHiddenColumns = EMPTY_DEFAULT_HIDDEN_COLUMNS,
  defaultMobileSummaryCount = 5,
  mobileSummaryColumnIds,
  pinnedLeadingColumns = EMPTY_DEFAULT_HIDDEN_COLUMNS,
  preferenceNamespace = "holdingsTableSettings",
  defaultSort,
  supportedSortFields,
}: UseHoldingsColumnSettingsOptions<ColumnId>): HoldingsColumnSettingsState<ColumnId> {
  const supportedSortFieldsKey = supportedSortFields?.join("|") ?? "";
  const normalizedSupportedSortFields = useMemo(
    () => supportedSortFieldsKey.split("|").filter((field): field is HoldingsSortField => field.length > 0),
    [supportedSortFieldsKey],
  );
  const sortEnabled = preferenceNamespace === "holdingsTableSettings"
    && defaultSort !== undefined
    && normalizedSupportedSortFields.length > 0;
  const resolvedDefaultSort = useMemo<RuntimeHoldingsSortPreference | undefined>(() => {
    if (!sortEnabled || !defaultSort) return undefined;
    return defaultSort.sortMode === "custom"
      ? { sortMode: "custom" }
      : { sortDirection: defaultSort.sortDirection, sortField: defaultSort.sortField, sortMode: "field" };
  }, [defaultSort?.sortMode, defaultSort?.sortMode === "field" ? defaultSort.sortDirection : undefined, defaultSort?.sortMode === "field" ? defaultSort.sortField : undefined, sortEnabled]);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const pinnedLeadingOrder = useMemo(
    () => pinnedLeadingColumns.filter((column, index) => columnIds.includes(column) && pinnedLeadingColumns.indexOf(column) === index),
    [columnIds, pinnedLeadingColumns],
  );
  const mobileSummaryCountMax = Math.max(1, mobileSummaryColumnIds?.length ?? columns.length);
  const defaultSettings = useMemo(
    () => buildDefaultSettings(columns, defaultLayoutStyle, defaultHiddenColumns, defaultMobileSummaryCount, mobileSummaryCountMax, pinnedLeadingOrder, resolvedDefaultSort),
    [columns, defaultLayoutStyle, defaultHiddenColumns, defaultMobileSummaryCount, mobileSummaryCountMax, pinnedLeadingOrder, resolvedDefaultSort],
  );
  const [contexts, setContexts] = useState<Record<string, HoldingsTableContextPreferenceDto>>({});
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [settings, setSettings] = useState<ColumnRuntimeSettings<ColumnId>>(defaultSettings);
  const [settingsError, setSettingsError] = useState("");
  const hasHydratedPreferencesRef = useRef(false);
  const hasLocalEditRef = useRef(false);
  const pendingDirtyContextRef = useRef<HoldingsTableContextPreferenceDto>({});
  const pendingIncludesRuntimeSortRef = useRef(false);
  const pendingSortIsExplicitRef = useRef(false);
  const requiresContextMigrationPersistRef = useRef(false);
  const contextsRef = useRef(contexts);
  const settingsRef = useRef(settings);

  useEffect(() => {
    contextsRef.current = contexts;
  }, [contexts]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    setSettings((current) => {
      const persistedContext = resolveHoldingsTableContextPreference(contextsRef.current, contextKey);
      const normalizationSource = hasHydratedPreferencesRef.current
        && !hasLocalEditRef.current
        && persistedContext?.sortMode === undefined
        ? persistedContext
        : current;
      const next = normalizeContextSettings(
        normalizationSource,
        columns,
        defaultLayoutStyle,
        defaultHiddenColumns,
        defaultMobileSummaryCount,
        mobileSummaryCountMax,
        pinnedLeadingOrder,
        resolvedDefaultSort,
        normalizedSupportedSortFields,
      );
      return columnSettingsEqual(current, next) ? current : next;
    });
  }, [columns, contextKey, defaultHiddenColumns, defaultLayoutStyle, defaultMobileSummaryCount, mobileSummaryCountMax, normalizedSupportedSortFields, pinnedLeadingOrder, resolvedDefaultSort]);

  useEffect(() => {
    let cancelled = false;
    const hydratePreferences = preferenceNamespace === "holdingsTableSettings"
      ? fetchHoldingsPreferences().then((response) => ({
          contexts: response.holdingsTableSettings.contexts,
          migrated: response.migratedHoldingsTableSettings,
        }))
      : getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" })
        .then((response) => {
          const parsed = readPreferenceSchema(preferenceNamespace).safeParse(response?.preferences?.[preferenceNamespace]);
          return {
            contexts: parsed.success ? parsed.data.contexts : {},
            migrated: false,
          };
        });
    void hydratePreferences
      .then(({ contexts: hydratedContexts, migrated }) => {
        if (cancelled) return;
        const nextContexts = hydratedContexts;
        requiresContextMigrationPersistRef.current = migrated;
        hasHydratedPreferencesRef.current = true;
        if (hasLocalEditRef.current) {
          const localContext = resolveHoldingsTableContextPreference(contextsRef.current, contextKey) ?? serializeSettings(
            settingsRef.current,
            contextKey,
            preferenceNamespace,
          );
          const mergedContexts = {
            ...nextContexts,
            ...contextsRef.current,
            [contextKey]: {
              ...resolveHoldingsTableContextPreference(nextContexts, contextKey),
              ...localContext,
            },
          };
          contextsRef.current = mergedContexts;
          setContexts(mergedContexts);
          const nextSettings = normalizeContextSettings(
            resolveHoldingsTableContextPreference(mergedContexts, contextKey),
            columns,
            defaultLayoutStyle,
            defaultHiddenColumns,
            defaultMobileSummaryCount,
            mobileSummaryCountMax,
            pinnedLeadingOrder,
            resolvedDefaultSort,
            normalizedSupportedSortFields,
          );
          setSettings((current) => columnSettingsEqual(current, nextSettings) ? current : nextSettings);
          const pendingDirtyContext = pendingDirtyContextRef.current;
          if (Object.keys(pendingDirtyContext).length > 0) {
            let outboundContext = migrated
              ? { ...mergedContexts[contextKey] }
              : { ...pendingDirtyContext };
            if (pendingIncludesRuntimeSortRef.current && !pendingSortIsExplicitRef.current) {
              delete outboundContext.sortMode;
              delete outboundContext.sortField;
              delete outboundContext.sortDirection;
              outboundContext = withPersistedRuntimeSort(
                outboundContext,
                nextSettings,
                preferenceNamespace,
                resolveHoldingsTableContextPreference(nextContexts, contextKey),
                normalizedSupportedSortFields,
              );
            }
            persistContexts(mergedContexts, { [contextKey]: outboundContext });
          }
          pendingDirtyContextRef.current = {};
          pendingIncludesRuntimeSortRef.current = false;
          pendingSortIsExplicitRef.current = false;
          return;
        }
        contextsRef.current = nextContexts;
        setContexts(nextContexts);
        setSettings((current) => {
          const next = normalizeContextSettings(
            resolveHoldingsTableContextPreference(nextContexts, contextKey),
            columns,
            defaultLayoutStyle,
            defaultHiddenColumns,
            defaultMobileSummaryCount,
            mobileSummaryCountMax,
            pinnedLeadingOrder,
            resolvedDefaultSort,
            normalizedSupportedSortFields,
          );
          return columnSettingsEqual(current, next) ? current : next;
        });
      })
      .catch(() => {
        // Keep local defaults when preference hydration is unavailable.
        // Do not persist column edits until a successful hydration can merge
        // existing contexts; PATCH replaces the top-level table preference.
      });
    return () => {
      cancelled = true;
    };
  }, [columns, contextKey, defaultHiddenColumns, defaultLayoutStyle, defaultMobileSummaryCount, mobileSummaryCountMax, normalizedSupportedSortFields, pinnedLeadingOrder, preferenceNamespace, resolvedDefaultSort]);

  const orderedColumns = useMemo(
    () => settings.columnOrder
      .map((columnId) => columns.find((column) => column.id === columnId))
      .filter((column): column is HoldingsGridColumnDefinition<ColumnId> => column !== undefined),
    [columns, settings.columnOrder],
  );

  function persistContexts(
    nextContexts: Record<string, HoldingsTableContextPreferenceDto>,
    dirtyContexts: Record<string, HoldingsTableContextPreferenceDto>,
  ) {
    if (preferenceNamespace === "holdingsTableSettings") {
      void persistHoldingsTableContexts(dirtyContexts, nextContexts).catch((error) => {
        setSettingsError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const payload = buildPreferencePayload(
      preferenceNamespace,
      sanitizeAdminMarketDataContextPatches(dirtyContexts),
    );
    void patchJson("/user-preferences", { [preferenceNamespace]: payload }, { contextScope: "session" })
      .catch((error) => {
        setSettingsError(error instanceof Error ? error.message : String(error));
      });
  }

  function persist(next: ColumnRuntimeSettings<ColumnId>) {
    hasLocalEditRef.current = true;
    const serialized = serializeSettings(
      next,
      contextKey,
      preferenceNamespace,
      contextsRef.current[contextKey],
    );
    const mergedContexts = {
      ...contextsRef.current,
      [contextKey]: { ...contextsRef.current[contextKey], ...serialized },
    };
    contextsRef.current = mergedContexts;
    setContexts(mergedContexts);
    setSettings(next);
    setSettingsError("");
    if (hasHydratedPreferencesRef.current) {
      const dirtyContext = withPersistedRuntimeSort(
        serialized,
        next,
        preferenceNamespace,
        contextsRef.current[contextKey],
        normalizedSupportedSortFields,
      );
      persistContexts(mergedContexts, { [contextKey]: dirtyContext });
    } else {
      pendingDirtyContextRef.current = { ...pendingDirtyContextRef.current, ...serialized };
      pendingIncludesRuntimeSortRef.current = true;
    }
  }

  function persistContextPatch(next: ColumnRuntimeSettings<ColumnId>, patch: HoldingsTableContextPreferenceDto) {
    hasLocalEditRef.current = true;
    const mergedContext = {
      ...contextsRef.current[contextKey],
      ...patch,
    };
    const mergedContexts = { ...contextsRef.current, [contextKey]: mergedContext };
    contextsRef.current = mergedContexts;
    setContexts(mergedContexts);
    setSettings(next);
    setSettingsError("");
    if (hasHydratedPreferencesRef.current) {
      persistContexts(mergedContexts, {
        [contextKey]: requiresContextMigrationPersistRef.current ? mergedContext : patch,
      });
    } else {
      pendingDirtyContextRef.current = { ...pendingDirtyContextRef.current, ...patch };
    }
  }

  function persistSort(next: ColumnRuntimeSettings<ColumnId>, sort: RuntimeHoldingsSortPreference) {
    hasLocalEditRef.current = true;
    const sortPatch: HoldingsTableContextPreferenceDto = { sortMode: sort.sortMode };
    if (sort.sortMode === "field" && sort.sortField && sort.sortDirection) {
      sortPatch.sortField = sort.sortField;
      sortPatch.sortDirection = sort.sortDirection;
    }
    const mergedContext: HoldingsTableContextPreferenceDto = {
      ...contextsRef.current[contextKey],
      ...(hasHydratedPreferencesRef.current
        ? serializeSettings(
            next,
            contextKey,
            preferenceNamespace,
            contextsRef.current[contextKey],
          )
        : {}),
      ...sortPatch,
    };
    if (sort.sortMode !== "field") {
      delete mergedContext.sortField;
      delete mergedContext.sortDirection;
    }
    const mergedContexts = { ...contextsRef.current, [contextKey]: mergedContext };
    contextsRef.current = mergedContexts;
    setContexts(mergedContexts);
    setSettings(next);
    setSettingsError("");
    if (hasHydratedPreferencesRef.current) {
      persistContexts(mergedContexts, {
        [contextKey]: sanitizeHoldingsTableContextPatches({ [contextKey]: mergedContext })[contextKey] ?? {},
      });
    } else {
      pendingDirtyContextRef.current = {
        ...pendingDirtyContextRef.current,
        ...sortPatch,
      };
      pendingSortIsExplicitRef.current = true;
    }
  }

  function toggleColumn(column: ColumnId) {
    const definition = columns.find((entry) => entry.id === column);
    if (definition?.canHide === false) return;
    const hidden = new Set(settings.hiddenColumns);
    if (hidden.has(column)) hidden.delete(column);
    else hidden.add(column);
    persist({ ...settings, hiddenColumns: [...hidden] });
  }

  function moveColumnBefore(source: ColumnId, target: ColumnId) {
    if (source === target) return;
    const withoutSource = settings.columnOrder.filter((column) => column !== source);
    const targetIndex = withoutSource.indexOf(target);
    if (targetIndex < 0) return;
    const nextOrder = withPinnedLeadingColumns(
      [...withoutSource.slice(0, targetIndex), source, ...withoutSource.slice(targetIndex)],
      pinnedLeadingOrder,
    );
    persist({ ...settings, columnOrder: nextOrder });
  }

  function moveColumn(column: ColumnId, direction: "left" | "right") {
    if (pinnedLeadingOrder.includes(column)) return;
    const currentIndex = settings.columnOrder.indexOf(column);
    const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= settings.columnOrder.length) return;
    const nextOrder = [...settings.columnOrder];
    const [source] = nextOrder.splice(currentIndex, 1);
    if (!source) return;
    nextOrder.splice(targetIndex, 0, source);
    persist({ ...settings, columnOrder: withPinnedLeadingColumns(nextOrder, pinnedLeadingOrder) });
  }

  function resetColumns() {
    persist({
      ...defaultSettings,
      rowOrder: settings.rowOrder,
      selectedMarketCodes: settings.selectedMarketCodes,
      selectedAccountIds: settings.selectedAccountIds,
      topHoldingsLimit: settings.topHoldingsLimit,
      sortMode: settings.sortMode,
      sortField: settings.sortField,
      sortDirection: settings.sortDirection,
    });
  }

  function resetRowOrder() {
    persist({ ...settings, rowOrder: [] });
  }

  function setLayoutStyle(style: HoldingsTableLayoutStyle) {
    persist({ ...settings, layoutStyle: style });
  }

  function setMobileSummaryCount(count: number) {
    persist({ ...settings, mobileSummaryCount: clampMobileSummaryCount(count, mobileSummaryCountMax) });
  }

  function setRowOrder(rowOrder: string[]) {
    const next = { ...settings, rowOrder: normalizeRowOrder(rowOrder) };
    if (sortEnabled) {
      next.sortMode = "custom";
      delete next.sortField;
      delete next.sortDirection;
      persistSort(next, { sortMode: "custom" });
      return;
    }
    persist(next);
  }

  function setSort(field: HoldingsSortField, direction?: HoldingsSortDirection) {
    if (!sortEnabled || !normalizedSupportedSortFields.includes(field)) return;
    const nextDirection = direction
      ?? (settings.sortMode === "field" && settings.sortField === field
        ? settings.sortDirection === "asc" ? "desc" : "asc"
        : defaultHoldingsSortDirection(field));
    const next = { ...settings, sortMode: "field" as const, sortField: field, sortDirection: nextDirection };
    persistSort(next, { sortMode: "field", sortField: field, sortDirection: nextDirection });
  }

  function setCustomSort() {
    if (!sortEnabled) return;
    const next = { ...settings, sortMode: "custom" as const };
    delete next.sortField;
    delete next.sortDirection;
    persistSort(next, { sortMode: "custom" });
  }

  function resetSort() {
    if (!sortEnabled || !resolvedDefaultSort) return;
    const next = { ...settings, ...resolvedDefaultSort };
    if (resolvedDefaultSort.sortMode === "custom") {
      delete next.sortField;
      delete next.sortDirection;
    }
    persistSort(next, resolvedDefaultSort);
  }

  function setSelectedMarketCodes(selectedMarketCodes: string[]) {
    const nextSelectedMarketCodes = normalizeSelectionValues(selectedMarketCodes);
    persistContextPatch(
      { ...settings, selectedMarketCodes: nextSelectedMarketCodes },
      { selectedMarketCodes: nextSelectedMarketCodes },
    );
  }

  function setSelectedAccountIds(selectedAccountIds: string[]) {
    const nextSelectedAccountIds = normalizeSelectionValues(selectedAccountIds);
    persistContextPatch(
      { ...settings, selectedAccountIds: nextSelectedAccountIds },
      { selectedAccountIds: nextSelectedAccountIds },
    );
  }

  function setTopHoldingsLimit(limit: number) {
    persist({ ...settings, topHoldingsLimit: clampTopHoldingsLimit(limit) });
  }

  function getColumnWidth(column: ColumnId) {
    return clampWidth(settings.columnWidths[column] ?? defaultSettings.columnWidths[column] ?? 128);
  }

  function headerProps(column: ColumnId) {
    return {
      draggable: true as const,
      onDragStart: (event: React.DragEvent<HTMLElement>) => {
        setDraggedColumn(column);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", column);
      },
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        const source = (event.dataTransfer.getData("text/plain") || draggedColumn) as ColumnId | null;
        setDraggedColumn(null);
        if (source && columnIds.includes(source)) {
          moveColumnBefore(source, column);
        }
      },
    };
  }

  function resizeProps(column: ColumnId) {
    return {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const startX = event.clientX;
        const startWidth = getColumnWidth(column);
        const handleMove = (moveEvent: globalThis.PointerEvent) => {
          const nextWidth = clampWidth(startWidth + moveEvent.clientX - startX);
          setSettings((current) => ({
            ...current,
            columnWidths: { ...current.columnWidths, [column]: nextWidth },
          }));
        };
        const handleUp = (upEvent: globalThis.PointerEvent) => {
          const nextWidth = clampWidth(startWidth + upEvent.clientX - startX);
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleUp);
          persist({
            ...settings,
            columnWidths: { ...settings.columnWidths, [column]: nextWidth },
          });
        };
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp, { once: true });
      },
    };
  }

  const sortState = sortEnabled ? {
    resetSort,
    setCustomSort,
    setSort,
    sortDirection: settings.sortDirection,
    sortField: settings.sortField,
    sortMode: settings.sortMode,
  } : {};

  return {
    allColumns: columns,
    orderedColumns,
    pinnedLeadingColumns: pinnedLeadingOrder,
    visibleColumns: settings.columnOrder.filter((column) => !settings.hiddenColumns.includes(column)),
    layoutStyle: settings.layoutStyle,
    mobileSummaryCount: clampMobileSummaryCount(settings.mobileSummaryCount, mobileSummaryCountMax),
    mobileSummaryCountMax,
    rowOrder: settings.rowOrder,
    selectedMarketCodes: settings.selectedMarketCodes,
    selectedAccountIds: settings.selectedAccountIds,
    settingsError,
    topHoldingsLimit: settings.topHoldingsLimit,
    getColumnWidth,
    headerProps,
    moveColumn,
    resizeProps,
    resetColumns,
    resetRowOrder,
    setLayoutStyle,
    setMobileSummaryCount,
    setRowOrder,
    setSelectedMarketCodes,
    setSelectedAccountIds,
    setTopHoldingsLimit,
    toggleColumn,
    ...sortState,
  };
}

export function HoldingsColumnSettingsMenu<ColumnId extends string>({
  copy,
  dict,
  enableLayoutStyle = false,
  getColumnLabel,
  settings,
  testIdPrefix = "holdings",
}: {
  copy?: Partial<HoldingsColumnSettingsCopy>;
  dict?: AppDictionary;
  enableLayoutStyle?: boolean;
  getColumnLabel?: (column: HoldingsGridColumnDefinition<ColumnId>) => string;
  settings: HoldingsColumnSettingsState<ColumnId>;
  testIdPrefix?: string;
}) {
  const resolvedCopy = { ...HOLDINGS_SETTINGS_FALLBACK_COPY, ...dict?.holdings, ...copy };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid={`${testIdPrefix}-column-settings`}>
          <Settings2 data-icon="inline-start" aria-hidden="true" />
          {resolvedCopy.columnSettingsButtonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{resolvedCopy.columnSettingsTitle}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-2 px-2 py-1.5">
          {settings.orderedColumns.map((column, index) => {
            const isFirst = index === 0;
            const isLast = index === settings.orderedColumns.length - 1;
            const pinnedLeadingColumn = settings.pinnedLeadingColumns.includes(column.id);
            const columnLabel = getColumnLabel?.(column) ?? column.label;
            return (
              <div key={column.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
                <Checkbox
                  checked={settings.visibleColumns.includes(column.id)}
                  disabled={column.canHide === false}
                  onCheckedChange={() => settings.toggleColumn(column.id)}
                  aria-label={resolvedCopy.toggleColumnAria.replace("{column}", columnLabel)}
                />
                <span className="min-w-0 flex-1 break-words">{columnLabel}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isFirst || pinnedLeadingColumn}
                    onClick={() => settings.moveColumn(column.id, "left")}
                    aria-label={resolvedCopy.moveColumnLeftAria.replace("{column}", columnLabel)}
                    data-testid={`${testIdPrefix}-column-move-left-${column.id}`}
                  >
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isLast || pinnedLeadingColumn}
                    onClick={() => settings.moveColumn(column.id, "right")}
                    aria-label={resolvedCopy.moveColumnRightAria.replace("{column}", columnLabel)}
                    data-testid={`${testIdPrefix}-column-move-right-${column.id}`}
                  >
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-2 px-2 py-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{resolvedCopy.mobileSummaryCountLabel}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{resolvedCopy.mobileSummaryCountHelp}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={settings.mobileSummaryCount <= 1}
                onClick={() => settings.setMobileSummaryCount(settings.mobileSummaryCount - 1)}
                aria-label={resolvedCopy.mobileSummaryCountDecreaseAria}
                data-testid={`${testIdPrefix}-mobile-summary-count-decrease`}
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </Button>
              <span className="min-w-8 text-center font-mono text-sm tabular-nums" data-testid={`${testIdPrefix}-mobile-summary-count`}>
                {settings.mobileSummaryCount}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={settings.mobileSummaryCount >= settings.mobileSummaryCountMax}
                onClick={() => settings.setMobileSummaryCount(settings.mobileSummaryCount + 1)}
                aria-label={resolvedCopy.mobileSummaryCountIncreaseAria}
                data-testid={`${testIdPrefix}-mobile-summary-count-increase`}
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
        {enableLayoutStyle ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex flex-col gap-2 px-2 py-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Rows3 className="size-4 shrink-0" aria-hidden="true" />
                {resolvedCopy.layoutStyleLabel}
              </div>
              <ToggleGroup
                type="single"
                value={settings.layoutStyle}
                onValueChange={(value) => {
                  if (value === "dashboard" || value === "portfolio") settings.setLayoutStyle(value);
                }}
                className="flex-wrap justify-start"
              >
                <ToggleGroupItem
                  value="dashboard"
                  className="h-auto whitespace-normal text-left leading-5"
                  data-testid={`${testIdPrefix}-layout-dashboard`}
                >
                  {resolvedCopy.layoutStyleCompact}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="portfolio"
                  className="h-auto whitespace-normal text-left leading-5"
                  data-testid={`${testIdPrefix}-layout-portfolio`}
                >
                  {resolvedCopy.layoutStyleDetailed}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          {settings.settingsError ? <p className="min-w-0 flex-1 break-words text-xs text-destructive">{settings.settingsError}</p> : <span />}
          <div className="flex flex-wrap justify-end gap-1">
            {settings.resetSort ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={settings.resetSort}
                data-testid={`${testIdPrefix}-reset-sort`}
              >
                <RotateCw data-icon="inline-start" aria-hidden="true" />
                {resolvedCopy.resetSortLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={settings.resetColumns}
              data-testid={`${testIdPrefix}-reset-columns`}
            >
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              {resolvedCopy.resetColumnsLabel}
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface HoldingsRowSettingsItem {
  id: string;
  label: string;
  description?: string;
}

export function HoldingsRowSettingsMenu<ColumnId extends string>({
  dict,
  rows,
  settings,
  showTopHoldingsLimit = false,
  testIdPrefix = "holdings",
}: {
  dict?: AppDictionary;
  rows: HoldingsRowSettingsItem[];
  settings: HoldingsColumnSettingsState<ColumnId>;
  showTopHoldingsLimit?: boolean;
  testIdPrefix?: string;
}) {
  const resolvedCopy = { ...HOLDINGS_SETTINGS_FALLBACK_COPY, ...dict?.holdings };
  const [draggedRow, setDraggedRow] = useState<string | null>(null);
  const orderedRows = applyHoldingsRowOrder(rows, (row) => row.id, settings.rowOrder);
  const visibleRowIds = useMemo(() => rows.map((row) => row.id), [rows]);

  function moveRow(rowId: string, direction: -1 | 1) {
    const ids = orderedRows.map((row) => row.id);
    const index = ids.indexOf(rowId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) return;
    const next = [...ids];
    const [source] = next.splice(index, 1);
    if (!source) return;
    next.splice(targetIndex, 0, source);
    settings.setRowOrder(mergeVisibleRowOrder(settings.rowOrder, visibleRowIds, next));
  }

  function moveRowBefore(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const ids = orderedRows.map((row) => row.id);
    const withoutSource = ids.filter((rowId) => rowId !== sourceId);
    const targetIndex = withoutSource.indexOf(targetId);
    if (targetIndex < 0) return;
    settings.setRowOrder(mergeVisibleRowOrder(settings.rowOrder, visibleRowIds, [
      ...withoutSource.slice(0, targetIndex),
      sourceId,
      ...withoutSource.slice(targetIndex),
    ]));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid={`${testIdPrefix}-row-settings`}>
          <ListOrdered data-icon="inline-start" aria-hidden="true" />
          {resolvedCopy.rowSettingsButtonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{resolvedCopy.rowSettingsTitle}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showTopHoldingsLimit ? (
          <>
            <div className="flex items-center justify-between gap-3 px-2 py-1.5">
              <p className="min-w-0 text-sm font-medium">{resolvedCopy.topHoldingsLimitLabel}</p>
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={settings.topHoldingsLimit <= MIN_TOP_HOLDINGS_LIMIT}
                  onClick={() => settings.setTopHoldingsLimit(settings.topHoldingsLimit - 1)}
                  aria-label={resolvedCopy.topHoldingsLimitDecreaseAria}
                  data-testid={`${testIdPrefix}-top-holdings-limit-decrease`}
                >
                  <Minus aria-hidden="true" />
                </Button>
                <span className="min-w-8 text-center font-mono text-sm tabular-nums" data-testid={`${testIdPrefix}-top-holdings-limit`}>
                  {settings.topHoldingsLimit}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={settings.topHoldingsLimit >= MAX_TOP_HOLDINGS_LIMIT}
                  onClick={() => settings.setTopHoldingsLimit(settings.topHoldingsLimit + 1)}
                  aria-label={resolvedCopy.topHoldingsLimitIncreaseAria}
                  data-testid={`${testIdPrefix}-top-holdings-limit-increase`}
                >
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto px-2 py-1.5">
          {orderedRows.map((row, index) => {
            const isFirst = index === 0;
            const isLast = index === orderedRows.length - 1;
            return (
              <div
                key={row.id}
                draggable
                onDragStart={(event) => {
                  setDraggedRow(row.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", row.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = event.dataTransfer.getData("text/plain") || draggedRow;
                  setDraggedRow(null);
                  if (source) moveRowBefore(source, row.id);
                }}
                className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"
                data-testid={`${testIdPrefix}-row-drag-${row.id}`}
                title={resolvedCopy.dragRowTitle.replace("{row}", row.label)}
              >
                <GripVertical className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.label}</p>
                  {row.description ? <p className="truncate text-xs text-muted-foreground">{row.description}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isFirst}
                    onClick={() => moveRow(row.id, -1)}
                    aria-label={resolvedCopy.moveRowUpAria.replace("{row}", row.label)}
                    data-testid={`${testIdPrefix}-row-move-up-${row.id}`}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isLast}
                    onClick={() => moveRow(row.id, 1)}
                    aria-label={resolvedCopy.moveRowDownAria.replace("{row}", row.label)}
                    data-testid={`${testIdPrefix}-row-move-down-${row.id}`}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <div className="flex justify-end px-2 py-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={settings.resetRowOrder}>
            <RotateCw data-icon="inline-start" aria-hidden="true" />
            {resolvedCopy.resetRowsLabel}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function applyHoldingsRowOrder<Row>(
  rows: Row[],
  getRowId: (row: Row) => string,
  rowOrder: string[],
): Row[] {
  if (rowOrder.length === 0) return rows;
  const orderIndex = new Map(rowOrder.map((rowId, index) => [rowId, index]));
  return rows
    .map((row, index) => ({ row, index, order: orderIndex.get(getRowId(row)) }))
    .sort((left, right) => {
      if (left.order !== undefined && right.order !== undefined) return left.order - right.order;
      if (left.order !== undefined) return -1;
      if (right.order !== undefined) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function HoldingsColumnHeaderContent<ColumnId extends string>({
  align = "left",
  column,
  copy,
  dict,
  label,
  settings,
  testIdPrefix = "holdings",
}: {
  align?: HoldingsColumnAlign;
  column: ColumnId;
  copy?: Partial<HoldingsColumnSettingsCopy>;
  dict?: AppDictionary;
  label: string;
  settings: HoldingsColumnSettingsState<ColumnId>;
  testIdPrefix?: string;
}) {
  const resolvedCopy = { ...HOLDINGS_SETTINGS_FALLBACK_COPY, ...dict?.holdings, ...copy };
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const sortField = resolveColumnSortField(settings, column);
  const activeDirection = settings.sortMode === "field" && settings.sortField === sortField
    ? settings.sortDirection
    : undefined;
  const displayedDirection = activeDirection ?? (sortField ? defaultHoldingsSortDirection(sortField) : undefined);
  const directionLabel = displayedDirection === "asc"
    ? resolvedCopy.sortAscendingLabel
    : resolvedCopy.sortDescendingLabel;
  const sortDescription = (activeDirection ? resolvedCopy.sortTooltip : resolvedCopy.sortActionTooltip)
    .replace("{column}", label)
    .replace("{direction}", directionLabel);
  return (
    <div
      className={cn(
        "group relative flex min-h-9 select-none items-center gap-1 pr-3",
        align === "right" ? "justify-end text-right" : "justify-start text-left",
      )}
    >
      <span
        {...settings.headerProps(column)}
        className="inline-flex shrink-0 cursor-grab items-center active:cursor-grabbing"
        data-testid={`${testIdPrefix}-column-drag-${column}`}
        title={resolvedCopy.dragColumnTitle.replace("{column}", label)}
      >
        <GripVertical className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </span>
      {sortField && settings.setSort ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-1 rounded-sm text-inherit outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={sortDescription}
                data-testid={`${testIdPrefix}-column-sort-${column}`}
                onBlur={() => setTooltipOpen(false)}
                onClick={() => settings.setSort?.(sortField)}
                onFocus={() => setTooltipOpen(true)}
                onMouseEnter={() => setTooltipOpen(true)}
                onMouseLeave={() => setTooltipOpen(false)}
              >
                <span className="min-w-0 break-words leading-tight">{label}</span>
                {activeDirection === "asc" ? (
                  <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
                ) : activeDirection === "desc" ? (
                  <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <ArrowUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} data-testid={`${testIdPrefix}-column-sort-tooltip-${column}`}>
              {sortDescription}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="min-w-0 break-words leading-tight">{label}</span>
      )}
      <span
        {...settings.resizeProps(column)}
        role="separator"
        aria-label={resolvedCopy.resizeColumnAria.replace("{column}", label)}
        className="absolute -right-1 top-1/2 h-6 w-2 -translate-y-1/2 cursor-col-resize rounded-sm bg-transparent transition-colors hover:bg-primary/30"
        data-testid={`${testIdPrefix}-column-resize-${column}`}
      />
    </div>
  );
}

export function holdingsSortableHeaderCellProps<ColumnId extends string>(
  settings: HoldingsColumnSettingsState<ColumnId>,
  column: ColumnId,
): { "aria-sort"?: "ascending" | "descending" } {
  const sortField = resolveColumnSortField(settings, column);
  if (!sortField || settings.sortMode !== "field" || settings.sortField !== sortField) return {};
  return { "aria-sort": settings.sortDirection === "asc" ? "ascending" : "descending" };
}

export function HoldingsMobileSortControls<ColumnId extends string>({
  columns,
  copy,
  dict,
  settings,
  testIdPrefix = "holdings",
}: {
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  copy?: Partial<HoldingsColumnSettingsCopy>;
  dict?: AppDictionary;
  settings: HoldingsColumnSettingsState<ColumnId>;
  testIdPrefix?: string;
}) {
  const resolvedCopy = { ...HOLDINGS_SETTINGS_FALLBACK_COPY, ...dict?.holdings, ...copy };
  const sortableColumns = uniqueSortableColumns(columns);
  if (!settings.setSort || sortableColumns.length === 0) return null;
  const hasActiveField = settings.sortMode === "field" && settings.sortField !== undefined && settings.sortDirection !== undefined;
  const nextDirection = settings.sortDirection === "asc" ? "desc" : "asc";
  const nextDirectionLabel = nextDirection === "asc" ? resolvedCopy.sortAscendingLabel : resolvedCopy.sortDescendingLabel;
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        <span>{resolvedCopy.mobileSortFieldLabel}</span>
        <Select
          value={hasActiveField ? settings.sortField : "custom"}
          onValueChange={(value) => {
            if (value === "custom") settings.setCustomSort?.();
            else if (isHoldingsSortField(value)) settings.setSort?.(value, defaultHoldingsSortDirection(value));
          }}
        >
          <SelectTrigger data-testid={`${testIdPrefix}-mobile-sort-field`} aria-label={resolvedCopy.mobileSortFieldLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="custom" disabled={!settings.setCustomSort}>{resolvedCopy.customSortLabel}</SelectItem>
              {sortableColumns.map((column) => (
                <SelectItem key={column.sortField} value={column.sortField}>{column.label}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-end"
        aria-label={hasActiveField
          ? resolvedCopy.mobileSortDirectionLabel.replace("{direction}", nextDirectionLabel)
          : resolvedCopy.mobileSortDirectionUnavailableLabel}
        data-testid={`${testIdPrefix}-mobile-sort-direction`}
        disabled={!hasActiveField}
        onClick={() => {
          if (hasActiveField) settings.setSort?.(settings.sortField!, nextDirection);
        }}
      >
        {hasActiveField && settings.sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
        {hasActiveField
          ? settings.sortDirection === "asc" ? resolvedCopy.sortAscendingLabel : resolvedCopy.sortDescendingLabel
          : resolvedCopy.customSortLabel}
      </Button>
      {settings.resetSort ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-end"
          aria-label={resolvedCopy.resetSortLabel}
          data-testid={`${testIdPrefix}-mobile-reset-sort`}
          onClick={settings.resetSort}
        >
          <RotateCw aria-hidden="true" />
          {resolvedCopy.resetSortLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function HoldingsHiddenSortChip<ColumnId extends string>({
  columns,
  copy,
  dict,
  settings,
  testIdPrefix = "holdings",
  visibleSortFields,
}: {
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  copy?: Partial<HoldingsColumnSettingsCopy>;
  dict?: AppDictionary;
  settings: HoldingsColumnSettingsState<ColumnId>;
  testIdPrefix?: string;
  visibleSortFields: readonly HoldingsSortField[];
}) {
  const resolvedCopy = { ...HOLDINGS_SETTINGS_FALLBACK_COPY, ...dict?.holdings, ...copy };
  if (
    !settings.setSort
    || !settings.resetSort
    || settings.sortMode !== "field"
    || !settings.sortField
    || !settings.sortDirection
    || visibleSortFields.includes(settings.sortField)
  ) return null;
  const column = uniqueSortableColumns(columns).find((candidate) => candidate.sortField === settings.sortField);
  if (!column) return null;
  const directionLabel = settings.sortDirection === "asc" ? resolvedCopy.sortAscendingLabel : resolvedCopy.sortDescendingLabel;
  const nextDirection = settings.sortDirection === "asc" ? "desc" : "asc";
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-xs"
      data-testid={`${testIdPrefix}-hidden-sort-chip`}
    >
      <span>{resolvedCopy.hiddenSortLabel.replace("{column}", column.label).replace("{direction}", directionLabel)}</span>
      <button
        type="button"
        className="rounded-sm p-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`${testIdPrefix}-hidden-sort-direction`}
        aria-label={resolvedCopy.mobileSortDirectionLabel.replace("{direction}", nextDirection === "asc" ? resolvedCopy.sortAscendingLabel : resolvedCopy.sortDescendingLabel)}
        onClick={() => settings.setSort?.(settings.sortField!, nextDirection)}
      >
        {settings.sortDirection === "asc" ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="rounded-sm p-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`${testIdPrefix}-hidden-sort-reset`}
        aria-label={resolvedCopy.resetSortLabel}
        onClick={() => settings.resetSort?.()}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}

function resolveColumnSortField<ColumnId extends string>(
  settings: HoldingsColumnSettingsState<ColumnId>,
  column: ColumnId,
): HoldingsSortField | undefined {
  const configured = settings.allColumns?.find((candidate) => candidate.id === column)?.sortField;
  if (configured) return configured;
  return isHoldingsSortField(column) ? column : undefined;
}

function uniqueSortableColumns<ColumnId extends string>(columns: Array<HoldingsGridColumnDefinition<ColumnId>>) {
  const seen = new Set<HoldingsSortField>();
  return columns.flatMap((column) => {
    if (!column.sortField || seen.has(column.sortField)) return [];
    seen.add(column.sortField);
    return [{ label: column.label, sortField: column.sortField }];
  });
}

function isHoldingsSortField(value: string): value is HoldingsSortField {
  return (HOLDINGS_SORT_FIELDS as readonly string[]).includes(value);
}

export function holdingsColumnCellStyle<ColumnId extends string>(
  settings: HoldingsColumnSettingsState<ColumnId>,
  column: ColumnId,
) {
  const width = settings.getColumnWidth(column);
  return {
    maxWidth: width,
    minWidth: Math.min(width, 180),
    width,
  };
}

export function filterAvailableHoldingsSelections(selectedIds: string[], availableIds: readonly string[]): string[] {
  if (selectedIds.length === 0 || availableIds.length === 0) return [];
  const available = new Set(availableIds);
  return selectedIds.filter((id) => available.has(id));
}

function buildDefaultSettings<ColumnId extends string>(
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>,
  layoutStyle: HoldingsTableLayoutStyle,
  defaultHiddenColumns: ColumnId[],
  defaultMobileSummaryCount: number,
  mobileSummaryCountMax: number,
  pinnedLeadingColumns: ColumnId[],
  defaultSort?: RuntimeHoldingsSortPreference,
): ColumnRuntimeSettings<ColumnId> {
  return {
    columnOrder: withPinnedLeadingColumns(columns.map((column) => column.id), pinnedLeadingColumns),
    hiddenColumns: defaultHiddenColumns,
    columnWidths: Object.fromEntries(columns.map((column) => [column.id, clampWidth(column.defaultWidth)])) as Record<ColumnId, number>,
    layoutStyle,
    mobileSummaryCount: clampMobileSummaryCount(defaultMobileSummaryCount, mobileSummaryCountMax),
    rowOrder: [],
    selectedMarketCodes: [],
    selectedAccountIds: [],
    topHoldingsLimit: DEFAULT_TOP_HOLDINGS_LIMIT,
    ...(defaultSort ?? {}),
  };
}

function normalizeContextSettings<ColumnId extends string>(
  rawSettings: HoldingsTableContextPreferenceDto | ColumnRuntimeSettings<ColumnId> | undefined,
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>,
  defaultLayoutStyle: HoldingsTableLayoutStyle,
  defaultHiddenColumns: ColumnId[],
  defaultMobileSummaryCount: number,
  mobileSummaryCountMax: number,
  pinnedLeadingColumns: ColumnId[],
  defaultSort: RuntimeHoldingsSortPreference | undefined,
  supportedSortFields: readonly HoldingsSortField[],
): ColumnRuntimeSettings<ColumnId> {
  const defaults = buildDefaultSettings(columns, defaultLayoutStyle, defaultHiddenColumns, defaultMobileSummaryCount, mobileSummaryCountMax, pinnedLeadingColumns, defaultSort);
  const validIds = new Set(columns.map((column) => column.id));
  const rawOrder = Array.isArray(rawSettings?.columnOrder) ? rawSettings.columnOrder : [];
  const normalizedRawOrder = normalizeRuntimeColumnIds(rawOrder, validIds);
  const columnOrder = withPinnedLeadingColumns([
    ...normalizedRawOrder,
    ...defaults.columnOrder.filter((column) => !normalizedRawOrder.includes(column)),
  ], pinnedLeadingColumns);
  const rawHiddenColumns = normalizeRuntimeColumnIds(
    Array.isArray(rawSettings?.hiddenColumns) ? rawSettings.hiddenColumns : [],
    validIds,
  );
  const hiddenColumns = rawSettings
    ? [
        ...rawHiddenColumns,
        ...defaultHiddenColumns.filter((column) => !normalizedRawOrder.includes(column) && !rawHiddenColumns.includes(column)),
      ]
    : defaults.hiddenColumns;
  const columnWidths = { ...defaults.columnWidths };
  for (const [column, width] of Object.entries(rawSettings?.columnWidths ?? {})) {
    const runtimeColumn = resolveRuntimeColumnId(column, validIds);
    if (runtimeColumn && typeof width === "number" && Number.isFinite(width)) {
      columnWidths[runtimeColumn] = clampWidth(width);
    }
  }
  const layoutStyle = rawSettings?.layoutStyle === "dashboard" || rawSettings?.layoutStyle === "portfolio"
    ? rawSettings.layoutStyle
    : defaultLayoutStyle;
  const mobileSummaryCount = typeof rawSettings?.mobileSummaryCount === "number"
    ? clampMobileSummaryCount(rawSettings.mobileSummaryCount, mobileSummaryCountMax)
    : defaults.mobileSummaryCount;
  const rowOrder = normalizeRowOrder(rawSettings?.rowOrder);
  const selectedMarketCodes = normalizeSelectionValues(rawSettings?.selectedMarketCodes);
  const selectedAccountIds = normalizeSelectionValues(rawSettings?.selectedAccountIds);
  const topHoldingsLimit = typeof rawSettings?.topHoldingsLimit === "number"
    ? clampTopHoldingsLimit(rawSettings.topHoldingsLimit)
    : defaults.topHoldingsLimit;
  const normalizedSort = defaultSort
    ? normalizeHoldingsSortPreference({
        defaultSort,
        rawContext: rawSettings as unknown as Record<string, unknown> | undefined,
        supportedFields: supportedSortFields,
      })
    : {};
  return { columnOrder, hiddenColumns, columnWidths, layoutStyle, mobileSummaryCount, rowOrder, selectedMarketCodes, selectedAccountIds, topHoldingsLimit, ...normalizedSort };
}

function normalizeRuntimeColumnIds<ColumnId extends string>(
  storedIds: readonly string[],
  validIds: ReadonlySet<ColumnId>,
): ColumnId[] {
  const normalized: ColumnId[] = [];
  for (const storedId of storedIds) {
    const runtimeId = resolveRuntimeColumnId(storedId, validIds);
    if (runtimeId && !normalized.includes(runtimeId)) normalized.push(runtimeId);
  }
  return normalized;
}

function resolveRuntimeColumnId<ColumnId extends string>(
  storedId: string,
  validIds: ReadonlySet<ColumnId>,
): ColumnId | undefined {
  if (validIds.has(storedId as ColumnId)) return storedId as ColumnId;
  return LEGACY_RUNTIME_COLUMN_IDS[storedId]
    ?.find((candidate): candidate is ColumnId => validIds.has(candidate as ColumnId));
}

function serializeSettings<ColumnId extends string>(
  settings: ColumnRuntimeSettings<ColumnId>,
  contextKey?: string,
  preferenceNamespace?: ColumnSettingsPreferenceNamespace,
  existingContext?: HoldingsTableContextPreferenceDto,
): HoldingsTableContextPreferenceDto {
  const serialized: HoldingsTableContextPreferenceDto = {
    columnOrder: settings.columnOrder,
    hiddenColumns: settings.hiddenColumns,
    columnWidths: settings.columnWidths,
    layoutStyle: settings.layoutStyle,
    mobileSummaryCount: settings.mobileSummaryCount,
    rowOrder: settings.rowOrder,
    selectedMarketCodes: settings.selectedMarketCodes,
    selectedAccountIds: settings.selectedAccountIds,
    topHoldingsLimit: settings.topHoldingsLimit,
  };
  if (preferenceNamespace !== "holdingsTableSettings" || !contextKey) return serialized;
  const canonical = canonicalizeHoldingsTableContextColumns(contextKey, serialized);
  return {
    ...canonical,
    columnWidths: {
      ...existingContext?.columnWidths,
      ...canonical.columnWidths,
    },
  };
}

function columnSettingsEqual<ColumnId extends string>(
  left: ColumnRuntimeSettings<ColumnId>,
  right: ColumnRuntimeSettings<ColumnId>,
): boolean {
  return left.layoutStyle === right.layoutStyle
    && left.mobileSummaryCount === right.mobileSummaryCount
    && left.topHoldingsLimit === right.topHoldingsLimit
    && left.sortMode === right.sortMode
    && left.sortField === right.sortField
    && left.sortDirection === right.sortDirection
    && arraysEqual(left.columnOrder, right.columnOrder)
    && arraysEqual(left.hiddenColumns, right.hiddenColumns)
    && arraysEqual(left.rowOrder, right.rowOrder)
    && arraysEqual(left.selectedMarketCodes, right.selectedMarketCodes)
    && arraysEqual(left.selectedAccountIds, right.selectedAccountIds)
    && recordEqual(left.columnWidths, right.columnWidths);
}

function arraysEqual<ColumnId extends string>(left: ColumnId[], right: ColumnId[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function recordEqual<ColumnId extends string>(left: Record<ColumnId, number>, right: Record<ColumnId, number>): boolean {
  const leftEntries = Object.entries(left) as Array<[ColumnId, number]>;
  const rightKeys = new Set(Object.keys(right));
  return leftEntries.length === rightKeys.size
    && leftEntries.every(([key, value]) => right[key] === value);
}

function clampWidth(width: number) {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}

function clampMobileSummaryCount(count: number, max: number) {
  return Math.max(1, Math.min(Math.max(1, max), Math.round(count)));
}

function clampTopHoldingsLimit(count: number) {
  return Math.max(MIN_TOP_HOLDINGS_LIMIT, Math.min(MAX_TOP_HOLDINGS_LIMIT, Math.round(count)));
}

function normalizeRowOrder(rowOrder: unknown): string[] {
  if (!Array.isArray(rowOrder)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const row of rowOrder) {
    if (typeof row !== "string" || row.length === 0 || seen.has(row)) continue;
    seen.add(row);
    normalized.push(row);
  }
  return normalized.slice(0, 500);
}

function normalizeSelectionValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.slice(0, 500);
}

function mergeVisibleRowOrder(existingOrder: string[], visibleRowIds: string[], nextVisibleOrder: string[]): string[] {
  const visible = new Set(visibleRowIds);
  const nextVisible = nextVisibleOrder.filter((rowId) => visible.has(rowId));
  const merged: string[] = [];
  let nextIndex = 0;
  for (const rowId of existingOrder) {
    if (visible.has(rowId)) {
      const nextRow = nextVisible[nextIndex];
      if (nextRow) {
        merged.push(nextRow);
        nextIndex += 1;
      }
      continue;
    }
    merged.push(rowId);
  }
  for (; nextIndex < nextVisible.length; nextIndex += 1) {
    const nextRow = nextVisible[nextIndex];
    if (nextRow) merged.push(nextRow);
  }
  return normalizeRowOrder(merged);
}

function readPreferenceSchema(namespace: ColumnSettingsPreferenceNamespace) {
  return namespace === "adminMarketDataTableSettings"
    ? adminMarketDataTableSettingsPreferenceSchema
    : holdingsTableSettingsPreferenceSchema;
}

function buildPreferencePayload(
  namespace: ColumnSettingsPreferenceNamespace,
  contexts: Record<string, HoldingsTableContextPreferenceDto>,
): HoldingsTableSettingsPreferenceDto | AdminMarketDataTableSettingsPreferenceDto {
  return namespace === "adminMarketDataTableSettings"
    ? { version: 1, contexts }
    : { version: 1, contexts };
}

const ADMIN_MARKET_DATA_CONTEXT_PATCH_KEYS = [
  "columnOrder",
  "hiddenColumns",
  "columnWidths",
  "layoutStyle",
  "mobileSummaryCount",
  "rowOrder",
  "selectedMarketCodes",
  "selectedAccountIds",
  "topHoldingsLimit",
  "tickerAllocationChartMode",
  "tickerAllocationTopN",
] as const;

function sanitizeAdminMarketDataContextPatches(
  contexts: Record<string, HoldingsTableContextPreferenceDto>,
): Record<string, HoldingsTableContextPreferenceDto> {
  const candidates = Object.fromEntries(Object.entries(contexts).map(([contextKey, context]) => {
    const raw = context as Record<string, unknown>;
    return [contextKey, Object.fromEntries(ADMIN_MARKET_DATA_CONTEXT_PATCH_KEYS.flatMap((key) => (
      raw[key] === undefined ? [] : [[key, raw[key]]]
    )))];
  }));
  return adminMarketDataTableSettingsPreferenceSchema.parse({ version: 1, contexts: candidates }).contexts;
}

function withPersistedRuntimeSort<ColumnId extends string>(
  serialized: HoldingsTableContextPreferenceDto,
  settings: ColumnRuntimeSettings<ColumnId>,
  namespace: ColumnSettingsPreferenceNamespace,
  storedContext: HoldingsTableContextPreferenceDto | undefined,
  supportedSortFields: readonly HoldingsSortField[],
): HoldingsTableContextPreferenceDto {
  if (namespace !== "holdingsTableSettings") return serialized;
  const raw = storedContext as Record<string, unknown> | undefined;
  const hasUnsupportedStoredSort = raw?.sortMode === "field"
    && typeof raw.sortField === "string"
    && !supportedSortFields.includes(raw.sortField as HoldingsSortField);
  if (hasUnsupportedStoredSort) return serialized;
  if (settings.sortMode === "custom") return { ...serialized, sortMode: "custom" };
  if (settings.sortMode === "field" && settings.sortField && settings.sortDirection) {
    return {
      ...serialized,
      sortMode: "field",
      sortField: settings.sortField,
      sortDirection: settings.sortDirection,
    };
  }
  return serialized;
}

function withPinnedLeadingColumns<ColumnId extends string>(columnOrder: ColumnId[], pinnedLeadingColumns: ColumnId[]) {
  if (pinnedLeadingColumns.length === 0) return columnOrder;
  const pinned = pinnedLeadingColumns.filter((column, index) => columnOrder.includes(column) && pinnedLeadingColumns.indexOf(column) === index);
  return [...pinned, ...columnOrder.filter((column) => !pinned.includes(column))];
}
