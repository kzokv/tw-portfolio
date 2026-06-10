"use client";

import { useEffect, useMemo, useState, type PointerEvent } from "react";
import type {
  HoldingsTableContextPreferenceDto,
  HoldingsTableLayoutStyle,
  HoldingsTableSettingsPreferenceDto,
} from "@vakwen/shared-types";
import { holdingsTableSettingsPreferenceSchema } from "@vakwen/shared-types";
import { ArrowLeft, ArrowRight, GripVertical, RotateCcw, Rows3, Settings2 } from "lucide-react";
import { getJson, patchJson } from "../../lib/api";
import type { AppDictionary } from "../../lib/i18n/types";
import { cn } from "../../lib/utils";
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

export type HoldingsColumnAlign = "left" | "right";

export interface HoldingsGridColumnDefinition<ColumnId extends string> {
  id: ColumnId;
  label: string;
  defaultWidth: number;
  canHide?: boolean;
  align?: HoldingsColumnAlign;
}

interface UserPreferencesResponse {
  preferences?: {
    holdingsTableSettings?: unknown;
  };
}

interface UseHoldingsColumnSettingsOptions<ColumnId extends string> {
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  contextKey: string;
  defaultLayoutStyle?: HoldingsTableLayoutStyle;
}

interface ColumnRuntimeSettings<ColumnId extends string> {
  columnOrder: ColumnId[];
  hiddenColumns: ColumnId[];
  columnWidths: Record<ColumnId, number>;
  layoutStyle: HoldingsTableLayoutStyle;
}

export interface HoldingsColumnSettingsState<ColumnId extends string> {
  allColumns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  orderedColumns: Array<HoldingsGridColumnDefinition<ColumnId>>;
  visibleColumns: ColumnId[];
  layoutStyle: HoldingsTableLayoutStyle;
  settingsError: string;
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
  setLayoutStyle: (style: HoldingsTableLayoutStyle) => void;
  toggleColumn: (column: ColumnId) => void;
}

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 420;
const HOLDINGS_SETTINGS_FALLBACK_COPY = {
  columnSettingsButtonLabel: "Columns",
  columnSettingsTitle: "Column settings",
  dragColumnTitle: "Drag to reorder {column}",
  layoutStyleLabel: "Holding layout",
  layoutStyleCompact: "Compact",
  layoutStyleDetailed: "Detailed",
  moveColumnLeftAria: "Move {column} column left",
  moveColumnRightAria: "Move {column} column right",
  resizeColumnAria: "Resize {column} column",
  resetColumnsLabel: "Reset",
  toggleColumnAria: "Show {column} column",
} satisfies Pick<
  AppDictionary["holdings"],
  | "columnSettingsButtonLabel"
  | "columnSettingsTitle"
  | "dragColumnTitle"
  | "layoutStyleLabel"
  | "layoutStyleCompact"
  | "layoutStyleDetailed"
  | "moveColumnLeftAria"
  | "moveColumnRightAria"
  | "resizeColumnAria"
  | "resetColumnsLabel"
  | "toggleColumnAria"
>;

export function useHoldingsColumnSettings<ColumnId extends string>({
  columns,
  contextKey,
  defaultLayoutStyle = "portfolio",
}: UseHoldingsColumnSettingsOptions<ColumnId>): HoldingsColumnSettingsState<ColumnId> {
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const defaultSettings = useMemo(
    () => buildDefaultSettings(columns, defaultLayoutStyle),
    [columns, defaultLayoutStyle],
  );
  const [contexts, setContexts] = useState<Record<string, HoldingsTableContextPreferenceDto>>({});
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [settings, setSettings] = useState<ColumnRuntimeSettings<ColumnId>>(defaultSettings);
  const [settingsError, setSettingsError] = useState("");

  useEffect(() => {
    setSettings((current) => normalizeContextSettings(current, columns, defaultLayoutStyle));
  }, [columns, defaultLayoutStyle]);

  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences")
      .then((response) => {
        if (cancelled) return;
        const parsed = holdingsTableSettingsPreferenceSchema.safeParse(response?.preferences?.holdingsTableSettings);
        const nextContexts = parsed.success ? parsed.data.contexts : {};
        setContexts(nextContexts);
        setSettings(normalizeContextSettings(nextContexts[contextKey], columns, defaultLayoutStyle));
      })
      .catch(() => {
        // Keep local defaults when preference hydration is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [columns, contextKey, defaultLayoutStyle]);

  const orderedColumns = useMemo(
    () => settings.columnOrder
      .map((columnId) => columns.find((column) => column.id === columnId))
      .filter((column): column is HoldingsGridColumnDefinition<ColumnId> => column !== undefined),
    [columns, settings.columnOrder],
  );

  function persist(next: ColumnRuntimeSettings<ColumnId>) {
    const serialized = serializeSettings(next);
    const mergedContexts = { ...contexts, [contextKey]: serialized };
    setContexts(mergedContexts);
    setSettings(next);
    setSettingsError("");
    const payload: HoldingsTableSettingsPreferenceDto = { version: 1, contexts: mergedContexts };
    void patchJson("/user-preferences", { holdingsTableSettings: payload })
      .catch((error) => {
        setSettingsError(error instanceof Error ? error.message : String(error));
      });
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
    const nextOrder = [...withoutSource.slice(0, targetIndex), source, ...withoutSource.slice(targetIndex)];
    persist({ ...settings, columnOrder: nextOrder });
  }

  function moveColumn(column: ColumnId, direction: "left" | "right") {
    const currentIndex = settings.columnOrder.indexOf(column);
    const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= settings.columnOrder.length) return;
    const nextOrder = [...settings.columnOrder];
    const [source] = nextOrder.splice(currentIndex, 1);
    if (!source) return;
    nextOrder.splice(targetIndex, 0, source);
    persist({ ...settings, columnOrder: nextOrder });
  }

  function resetColumns() {
    persist(defaultSettings);
  }

  function setLayoutStyle(style: HoldingsTableLayoutStyle) {
    persist({ ...settings, layoutStyle: style });
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

  return {
    allColumns: columns,
    orderedColumns,
    visibleColumns: settings.columnOrder.filter((column) => !settings.hiddenColumns.includes(column)),
    layoutStyle: settings.layoutStyle,
    settingsError,
    getColumnWidth,
    headerProps,
    moveColumn,
    resizeProps,
    resetColumns,
    setLayoutStyle,
    toggleColumn,
  };
}

export function HoldingsColumnSettingsMenu<ColumnId extends string>({
  dict,
  enableLayoutStyle = false,
  settings,
}: {
  dict?: AppDictionary;
  enableLayoutStyle?: boolean;
  settings: HoldingsColumnSettingsState<ColumnId>;
}) {
  const copy = dict?.holdings ?? HOLDINGS_SETTINGS_FALLBACK_COPY;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="holdings-column-settings">
          <Settings2 data-icon="inline-start" aria-hidden="true" />
          {copy.columnSettingsButtonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{copy.columnSettingsTitle}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-2 px-2 py-1.5">
          {settings.orderedColumns.map((column, index) => {
            const isFirst = index === 0;
            const isLast = index === settings.orderedColumns.length - 1;
            return (
              <div key={column.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
                <Checkbox
                  checked={settings.visibleColumns.includes(column.id)}
                  disabled={column.canHide === false}
                  onCheckedChange={() => settings.toggleColumn(column.id)}
                  aria-label={copy.toggleColumnAria.replace("{column}", column.label)}
                />
                <span className="min-w-0 flex-1 break-words">{column.label}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isFirst}
                    onClick={() => settings.moveColumn(column.id, "left")}
                    aria-label={copy.moveColumnLeftAria.replace("{column}", column.label)}
                    data-testid={`holdings-column-move-left-${column.id}`}
                  >
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isLast}
                    onClick={() => settings.moveColumn(column.id, "right")}
                    aria-label={copy.moveColumnRightAria.replace("{column}", column.label)}
                    data-testid={`holdings-column-move-right-${column.id}`}
                  >
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {enableLayoutStyle ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex flex-col gap-2 px-2 py-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Rows3 data-icon="inline-start" aria-hidden="true" />
                {copy.layoutStyleLabel}
              </div>
              <ToggleGroup
                type="single"
                value={settings.layoutStyle}
                onValueChange={(value) => {
                  if (value === "dashboard" || value === "portfolio") settings.setLayoutStyle(value);
                }}
                className="justify-start"
              >
                <ToggleGroupItem value="dashboard" data-testid="holdings-layout-dashboard">{copy.layoutStyleCompact}</ToggleGroupItem>
                <ToggleGroupItem value="portfolio" data-testid="holdings-layout-portfolio">{copy.layoutStyleDetailed}</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          {settings.settingsError ? <p className="min-w-0 flex-1 break-words text-xs text-destructive">{settings.settingsError}</p> : <span />}
          <Button type="button" variant="ghost" size="sm" onClick={settings.resetColumns}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            {copy.resetColumnsLabel}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HoldingsColumnHeaderContent<ColumnId extends string>({
  align = "left",
  column,
  dict,
  label,
  settings,
}: {
  align?: HoldingsColumnAlign;
  column: ColumnId;
  dict?: AppDictionary;
  label: string;
  settings: HoldingsColumnSettingsState<ColumnId>;
}) {
  const copy = dict?.holdings ?? HOLDINGS_SETTINGS_FALLBACK_COPY;
  return (
    <div
      {...settings.headerProps(column)}
      className={cn(
        "group relative flex min-h-9 cursor-grab select-none items-center gap-1 pr-3 active:cursor-grabbing",
        align === "right" ? "justify-end text-right" : "justify-start text-left",
      )}
      data-testid={`holdings-column-drag-${column}`}
      title={copy.dragColumnTitle.replace("{column}", label)}
    >
      <GripVertical className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      <span className="min-w-0 break-words leading-tight">{label}</span>
      <span
        {...settings.resizeProps(column)}
        role="separator"
        aria-label={copy.resizeColumnAria.replace("{column}", label)}
        className="absolute -right-1 top-1/2 h-6 w-2 -translate-y-1/2 cursor-col-resize rounded-sm bg-transparent transition-colors hover:bg-primary/30"
        data-testid={`holdings-column-resize-${column}`}
      />
    </div>
  );
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

function buildDefaultSettings<ColumnId extends string>(
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>,
  layoutStyle: HoldingsTableLayoutStyle,
): ColumnRuntimeSettings<ColumnId> {
  return {
    columnOrder: columns.map((column) => column.id),
    hiddenColumns: [],
    columnWidths: Object.fromEntries(columns.map((column) => [column.id, clampWidth(column.defaultWidth)])) as Record<ColumnId, number>,
    layoutStyle,
  };
}

function normalizeContextSettings<ColumnId extends string>(
  rawSettings: HoldingsTableContextPreferenceDto | ColumnRuntimeSettings<ColumnId> | undefined,
  columns: Array<HoldingsGridColumnDefinition<ColumnId>>,
  defaultLayoutStyle: HoldingsTableLayoutStyle,
): ColumnRuntimeSettings<ColumnId> {
  const defaults = buildDefaultSettings(columns, defaultLayoutStyle);
  const validIds = new Set(columns.map((column) => column.id));
  const rawOrder = Array.isArray(rawSettings?.columnOrder) ? rawSettings.columnOrder : [];
  const columnOrder = [
    ...rawOrder.filter((column): column is ColumnId => validIds.has(column as ColumnId)) as ColumnId[],
    ...defaults.columnOrder.filter((column) => !rawOrder.includes(column)),
  ];
  const hiddenColumns = (Array.isArray(rawSettings?.hiddenColumns) ? rawSettings.hiddenColumns : [])
    .filter((column): column is ColumnId => validIds.has(column as ColumnId));
  const columnWidths = { ...defaults.columnWidths };
  for (const [column, width] of Object.entries(rawSettings?.columnWidths ?? {})) {
    if (validIds.has(column as ColumnId) && typeof width === "number" && Number.isFinite(width)) {
      columnWidths[column as ColumnId] = clampWidth(width);
    }
  }
  const layoutStyle = rawSettings?.layoutStyle === "dashboard" || rawSettings?.layoutStyle === "portfolio"
    ? rawSettings.layoutStyle
    : defaultLayoutStyle;
  return { columnOrder, hiddenColumns, columnWidths, layoutStyle };
}

function serializeSettings<ColumnId extends string>(
  settings: ColumnRuntimeSettings<ColumnId>,
): HoldingsTableContextPreferenceDto {
  return {
    columnOrder: settings.columnOrder,
    hiddenColumns: settings.hiddenColumns,
    columnWidths: settings.columnWidths,
    layoutStyle: settings.layoutStyle,
  };
}

function clampWidth(width: number) {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}
