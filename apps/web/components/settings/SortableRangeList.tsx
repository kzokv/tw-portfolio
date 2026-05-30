"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../lib/utils";

/**
 * KZO-161 — shared primitive for the F4 "Customize ranges" popover rows
 * AND the F4a admin dashboard-timeframe-defaults list.
 *
 * Contract (design §4):
 *   - Rows are keyed by `range` (canonical token, e.g. "1M", "5Y", "YTD").
 *   - `onReorder(nextOrder)` fires on drop with the final order. The parent
 *     owns persistence.
 *   - `onToggleVisibility` is F4-only. Admin (F4a) omits the prop and uses
 *     its separate "Available" chip palette for add/remove.
 *   - Sensors: Pointer + Keyboard only. No Touch here — the F5 card grid
 *     owns mobile long-press drag; range lists are touch-usable without
 *     drag-reorder (users can still toggle or re-add chips).
 *   - `disabled={true}` on any row disables all interactions for the row
 *     via `useSortable({ disabled })`.
 */
export interface SortableRangeRow {
  range: string;
  active: boolean;
  disabled?: boolean;
}

export interface SortableRangeListProps {
  rows: SortableRangeRow[];
  onReorder: (nextOrder: string[]) => void;
  onToggleVisibility?: (range: string) => void;
  dragHandleTestId: (range: string) => string;
  rowTestId?: (range: string) => string;
  chipTestId: (range: string) => string;
  toggleTestId?: (range: string) => string;
  /** Label on the trash/eye icon for a11y — consumer supplies the i18n. */
  toggleLabel?: (range: string, active: boolean) => string;
}

export function SortableRangeList({
  rows,
  onReorder,
  onToggleVisibility,
  dragHandleTestId,
  rowTestId,
  chipTestId,
  toggleTestId,
  toggleLabel,
}: SortableRangeListProps): JSX.Element {
  // Defer-mount gate (dnd-kit SSR hydration fix):
  // dnd-kit's `useSortable` produces browser-only `attributes` (including
  // dynamically-generated `aria-describedby` IDs pointing at the live-region
  // announcer injected by `DndContext`). Server-side render and first client
  // hydration produce different IDs → React hydration mismatch warning +
  // unreliable PointerSensor init.
  //
  // Fix (canonical dnd-kit pattern): render a static, non-sortable fallback
  // that shares ALL testids and visual structure with the real sortable,
  // then swap to the real `<DndContext>` on mount. First server + initial
  // client render both emit the static fallback → hydration passes. The
  // useEffect fires post-hydration, flips `isMounted`, and React does a
  // plain client-only re-render with the real sortable enabled.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = useMemo(() => rows.map((row) => row.range), [rows]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.indexOf(String(active.id));
    const newIndex = items.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  const handleKeyboardMove = (range: string, delta: -1 | 1) => {
    const oldIndex = items.indexOf(range);
    const newIndex = oldIndex + delta;
    if (oldIndex < 0 || newIndex < 0 || newIndex >= items.length) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  if (!isMounted) {
    // Static fallback — same testids + DOM shape as the sortable variant,
    // but without dnd-kit hooks (no hydration-differing aria-describedby).
    return (
      <ul className="space-y-2">
        {rows.map((row) => (
          <StaticRangeRowItem
            key={row.range}
            row={row}
            dragHandleTestId={dragHandleTestId}
            rowTestId={rowTestId}
            chipTestId={chipTestId}
            toggleTestId={toggleTestId}
            onToggleVisibility={onToggleVisibility}
            toggleLabel={toggleLabel}
          />
        ))}
      </ul>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {rows.map((row) => (
            <SortableRangeRowItem
              key={row.range}
              row={row}
              dragHandleTestId={dragHandleTestId}
              rowTestId={rowTestId}
              chipTestId={chipTestId}
              toggleTestId={toggleTestId}
              onToggleVisibility={onToggleVisibility}
              toggleLabel={toggleLabel}
              onKeyboardMove={handleKeyboardMove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/**
 * Static row — matches `SortableRangeRowItem`'s DOM shape and testids but
 * has no dnd-kit hooks. Rendered pre-mount (and during SSR) to keep server
 * and first-client-render output identical. The chip-click toggle still
 * fires via `onToggleVisibility` so clicks work even before hydration
 * (though realistically the drag affordance is the primary reason to delay).
 */
function StaticRangeRowItem({
  row,
  dragHandleTestId,
  rowTestId,
  chipTestId,
  toggleTestId,
  onToggleVisibility,
  toggleLabel,
}: {
  row: SortableRangeRow;
  dragHandleTestId: (range: string) => string;
  rowTestId?: (range: string) => string;
  chipTestId: (range: string) => string;
  toggleTestId?: (range: string) => string;
  onToggleVisibility?: (range: string) => void;
  toggleLabel?: (range: string, active: boolean) => string;
}) {
  return (
    <li
      data-testid={rowTestId?.(row.range)}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-2 py-1",
      )}
    >
      <button
        type="button"
        disabled
        aria-label={`Drag to reorder ${row.range}`}
        className="rounded p-1 text-slate-400 opacity-30"
        data-testid={dragHandleTestId(row.range)}
        style={{ cursor: "not-allowed" }}
      >
        <span aria-hidden="true" className="text-sm leading-none">⠿</span>
      </button>

      {onToggleVisibility ? (
        <button
          type="button"
          onClick={() => onToggleVisibility(row.range)}
          disabled={row.disabled}
          aria-label={toggleLabel?.(row.range, row.active) ?? `Toggle ${row.range}`}
          className={cn(
            "inline-flex min-w-[3.5rem] items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60",
            row.active
              ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
          )}
          data-testid={chipTestId(row.range)}
          data-active={row.active ? "true" : "false"}
        >
          {row.range}
        </button>
      ) : (
        <span
          className={cn(
            "inline-flex min-w-[3.5rem] items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold",
            row.active
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-slate-200 bg-white text-slate-500",
          )}
          data-testid={chipTestId(row.range)}
          data-active={row.active ? "true" : "false"}
        >
          {row.range}
        </span>
      )}

      {onToggleVisibility && toggleTestId ? (
        <button
          type="button"
          onClick={() => onToggleVisibility(row.range)}
          disabled={row.disabled}
          className="ml-auto rounded p-1 text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={toggleLabel?.(row.range, row.active) ?? `Toggle ${row.range}`}
          data-testid={toggleTestId(row.range)}
          data-toggled={row.active ? "on" : "off"}
        >
          {row.active ? "✓" : "○"}
        </button>
      ) : null}
    </li>
  );
}

function SortableRangeRowItem({
  row,
  dragHandleTestId,
  rowTestId,
  chipTestId,
  toggleTestId,
  onToggleVisibility,
  toggleLabel,
  onKeyboardMove,
}: {
  row: SortableRangeRow;
  dragHandleTestId: (range: string) => string;
  rowTestId?: (range: string) => string;
  chipTestId: (range: string) => string;
  toggleTestId?: (range: string) => string;
  onToggleVisibility?: (range: string) => void;
  toggleLabel?: (range: string, active: boolean) => string;
  onKeyboardMove: (range: string, delta: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.range, disabled: row.disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={rowTestId?.(row.range)}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-2 py-1",
        isDragging && "opacity-80 shadow-md",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={row.disabled}
        aria-label={`Drag to reorder ${row.range}`}
        onKeyDown={(event) => {
          if (row.disabled) return;
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            onKeyboardMove(row.range, event.key === "ArrowUp" ? -1 : 1);
          }
        }}
        className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
        data-testid={dragHandleTestId(row.range)}
        style={{ touchAction: "none", cursor: row.disabled ? "not-allowed" : "grab" }}
      >
        <span aria-hidden="true" className="text-sm leading-none">⠿</span>
      </button>

      {/*
        Chip: clickable when `onToggleVisibility` is provided so the admin's
        existing `clickAdminTimeframeChip(range)` AAA action (which targets
        `timeframe-chip-{range}`) keeps working after the F4a dnd-kit
        retrofit. Popover callers also get a second dedicated `timeframe-toggle-{range}`
        button below for explicit visibility toggling.
      */}
      {onToggleVisibility ? (
        <button
          type="button"
          onClick={() => onToggleVisibility(row.range)}
          disabled={row.disabled}
          aria-label={toggleLabel?.(row.range, row.active) ?? `Toggle ${row.range}`}
          className={cn(
            "inline-flex min-w-[3.5rem] items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60",
            row.active
              ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
          )}
          data-testid={chipTestId(row.range)}
          data-active={row.active ? "true" : "false"}
        >
          {row.range}
        </button>
      ) : (
        <span
          className={cn(
            "inline-flex min-w-[3.5rem] items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold",
            row.active
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-slate-200 bg-white text-slate-500",
          )}
          data-testid={chipTestId(row.range)}
          data-active={row.active ? "true" : "false"}
        >
          {row.range}
        </span>
      )}

      {onToggleVisibility && toggleTestId ? (
        <button
          type="button"
          onClick={() => onToggleVisibility(row.range)}
          disabled={row.disabled}
          className="ml-auto rounded p-1 text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={toggleLabel?.(row.range, row.active) ?? `Toggle ${row.range}`}
          data-testid={toggleTestId(row.range)}
          data-toggled={row.active ? "on" : "off"}
        >
          {row.active ? "✓" : "○"}
        </button>
      ) : null}
    </li>
  );
}
