"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  type CollisionDetection,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../lib/utils";
import { getJson, patchJson } from "../../lib/api";

/**
 * KZO-161 — page-agnostic sortable grid primitive (design §5 and §6).
 *
 * Consumers pass a canonical `cards` list + `orderKey` (the JSONB sub-key
 * in `user_preferences.cardOrder`, e.g. `"dashboard"`). The grid:
 *
 *   - Fetches the user's saved order on mount and merges with canonical
 *     via `mergeCardOrder` (unknown slugs dropped, new slugs appended).
 *   - Provides a `<DndContext>` + `<SortableContext>` wrapper with
 *     Pointer, Keyboard, and Touch sensors (TouchSensor has a 250 ms
 *     long-press activation delay per locked decision 13).
 *   - Handles optimistic UI: drag updates render immediately; a debounced
 *     250 ms PATCH persists the new order. On PATCH failure, UI reverts
 *     to the last server-confirmed snapshot (not pre-drag) so multiple
 *     drags within the debounce window collapse to a single baseline.
 *   - Shows a short transient toast on TouchSensor activation so mobile
 *     users know the long-press reorder handle engaged.
 *
 * The primitive is deliberately render-prop based: heterogeneous card
 * props are wired in the consumer's inline `switch (slug)` block, which
 * keeps the primitive free of page-specific type surface. KZO-162 will
 * wire other pages without re-implementing any drag mechanics.
 */

import { mergeCardOrder } from "./mergeCardOrder";

// Re-export for consumers and unit tests that want the merge helper alongside
// the grid component (design §5 contract allows inlining or sibling-helper).
export { mergeCardOrder };

interface SortableCard {
  readonly slug: string;
  readonly fullWidth: boolean;
}

interface SortableCardGridProps {
  cards: ReadonlyArray<SortableCard>;
  /** Sub-key inside `user_preferences.cardOrder`, e.g. "dashboard". */
  orderKey: string;
  /** Render-prop: returns the JSX for a given slug. */
  children: (slug: string) => ReactNode;
  /** Optional hook so tests can observe PATCH failures. */
  onPersistFailure?: (error: unknown) => void;
  /**
   * @internal Override the debounce window in tests. Defaults to 250ms.
   * The leading underscore telegraphs test-only intent — production callers
   * must NEVER set this.
   */
  _debounceMs?: number;
}

interface UserPreferencesResponse {
  preferences?: {
    cardOrder?: Partial<Record<string, string[]>> | null;
  } | null;
}

const TOAST_MS = 1800;

const pointerWithinThenClosestCenter: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

export function SortableCardGrid({
  cards,
  orderKey,
  children,
  onPersistFailure,
  _debounceMs = 250,
}: SortableCardGridProps): JSX.Element {
  const canonicalOrder = useMemo(() => cards.map((card) => card.slug), [cards]);
  const fullWidthSet = useMemo(
    () => new Set(cards.filter((card) => card.fullWidth).map((card) => card.slug)),
    [cards],
  );

  // Defer-mount gate — see the same pattern in `SortableRangeList.tsx` for
  // the full explanation. dnd-kit's `useSortable` injects dynamically-
  // generated `aria-describedby` IDs that differ between SSR and client
  // hydration; rendering the real `<DndContext>` only after mount avoids
  // the hydration mismatch warning + flaky PointerSensor init.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // displayOrder — optimistic UI, seeded with canonical until the GET lands.
  const [displayOrder, setDisplayOrder] = useState<string[]>(canonicalOrder);
  // serverConfirmedOrder — last known-good baseline for rollback on PATCH
  // failure. Advances only after a successful PATCH (or the initial GET).
  const serverConfirmedOrderRef = useRef<string[]>(canonicalOrder);

  // Touch-activation toast — only fires for the Touch sensor onDragStart.
  const [mobileDragToast, setMobileDragToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );

  // Initial hydration from GET /user-preferences (once per mount). We use the
  // same cancelled-flag pattern as AppShell to guard against the stale-close
  // race on fast unmounts.
  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences")
      .then((res) => {
        if (cancelled) return;
        const savedOrder = res?.preferences?.cardOrder?.[orderKey] ?? null;
        const merged = mergeCardOrder(
          cards,
          Array.isArray(savedOrder) ? savedOrder : null,
        ).map((card) => card.slug);
        setDisplayOrder(merged);
        serverConfirmedOrderRef.current = merged;
      })
      .catch(() => {
        // Silent fallback: canonical order remains in state.
      });
    return () => {
      cancelled = true;
    };
    // `cards` omitted intentionally: re-hydrating on every cards identity
    // change would defeat the optimistic display order. The second useEffect
    // on [cards] handles re-alignment when the canonical list changes. This
    // repo's ESLint config does not enable the react-hooks plugin so no
    // exhaustive-deps warning fires; documenting intent here so the omission
    // is not "fixed" later.
  }, [orderKey]);

  // Re-align if the canonical list changes (card added/removed from DASHBOARD_CARDS
  // between mounts) — keep any user-chosen ordering for slugs that still exist.
  useEffect(() => {
    setDisplayOrder((prev) => {
      const merged = mergeCardOrder(cards, prev).map((card) => card.slug);
      return areOrdersEqual(prev, merged) ? prev : merged;
    });
  }, [cards]);

  // Clean up pending timers on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const persist = useCallback(
    (orderToPersist: string[]) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void patchJson("/user-preferences", {
          cardOrder: { [orderKey]: orderToPersist },
        })
          .then(() => {
            serverConfirmedOrderRef.current = orderToPersist;
          })
          .catch((error) => {
            // Rollback to last confirmed baseline (not pre-drag). Multiple
            // drags during the debounce window share a single baseline.
            setDisplayOrder([...serverConfirmedOrderRef.current]);
            onPersistFailure?.(error);
          });
      }, _debounceMs);
    },
    [orderKey, onPersistFailure, _debounceMs],
  );

  const handleDragStart = useCallback((event: { activatorEvent: Event }) => {
    // Fire the mobile toast only when the Touch sensor activated the drag —
    // `activatorEvent` is a TouchEvent in that case.
    const evt = event.activatorEvent;
    const isTouch = typeof TouchEvent !== "undefined" && evt instanceof TouchEvent;
    if (!isTouch) return;
    setMobileDragToast("Card selected — drag to reorder");
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setMobileDragToast(null), TOAST_MS);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      setDisplayOrder((current) => {
        const oldIndex = current.indexOf(activeId);
        const newIndex = current.indexOf(overId);
        if (oldIndex < 0 || newIndex < 0) return current;
        const next = arrayMove(current, oldIndex, newIndex);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Test-only escape hatch for the unit test harness (the test runner cannot
  // simulate dnd-kit's PointerSensor events under jsdom; drag behaviour is
  // covered by E2E. Exposing this as a function property on the DOM node
  // lets the unit test drive the persist/rollback state machine directly.)
  // Production code has no reference to this property; do not use.
  const gridRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      (node as HTMLDivElement & {
        _testOnDragEnd?: (nextOrder: string[]) => void;
      })._testOnDragEnd = (nextOrder: string[]) => {
        setDisplayOrder(nextOrder);
        persist(nextOrder);
      };
    },
    [persist],
  );

  if (!isMounted) {
    // Static pre-mount fallback — same grid shape + testids as the sortable
    // variant, but no `<DndContext>` / `useSortable`. Keeps SSR and first
    // client hydration identical (see isMounted note above).
    return (
      <div
        ref={gridRef}
        data-testid="sortable-card-grid"
        className="grid grid-cols-1 gap-6 xl:grid-cols-2 [grid-auto-flow:dense]"
      >
        {displayOrder.map((slug) => (
          <StaticCardCell
            key={slug}
            slug={slug}
            fullWidth={fullWidthSet.has(slug)}
          >
            {children(slug)}
          </StaticCardCell>
        ))}
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithinThenClosestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={displayOrder} strategy={rectSortingStrategy}>
          <div
            ref={gridRef}
            data-testid="sortable-card-grid"
            className="grid grid-cols-1 gap-6 xl:grid-cols-2 [grid-auto-flow:dense]"
          >
            {displayOrder.map((slug) => (
              <SortableCardCell
                key={slug}
                slug={slug}
                fullWidth={fullWidthSet.has(slug)}
              >
                {children(slug)}
              </SortableCardCell>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {mobileDragToast ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="card-drag-toast"
          className="pointer-events-none fixed left-1/2 bottom-6 z-50 -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-xs font-medium text-white shadow-lg"
        >
          {mobileDragToast}
        </div>
      ) : null}
    </>
  );
}

function SortableCardCell({
  slug,
  fullWidth,
  children,
}: {
  slug: string;
  fullWidth: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slug });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative min-w-0",
        fullWidth && "xl:col-span-2",
        isDragging && "z-10 opacity-80",
      )}
      data-testid={`card-${slug}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        data-testid={`card-drag-handle-${slug}`}
        aria-label={`Reorder ${slug}`}
        className="absolute -left-2 -top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        style={{ touchAction: "none" }}
      >
        <span aria-hidden="true" className="text-sm leading-none">⠿</span>
      </button>
      {children}
    </div>
  );
}

/**
 * Static cell — matches `SortableCardCell`'s DOM shape and testids but has
 * no dnd-kit hooks. Rendered pre-mount to keep SSR and first-client-render
 * output identical. Swapped for `SortableCardCell` after hydration.
 */
function StaticCardCell({
  slug,
  fullWidth,
  children,
}: {
  slug: string;
  fullWidth: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0",
        fullWidth && "xl:col-span-2",
      )}
      data-testid={`card-${slug}`}
    >
      <button
        type="button"
        disabled
        data-testid={`card-drag-handle-${slug}`}
        aria-label={`Reorder ${slug}`}
        className="absolute -left-2 -top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md opacity-60"
      >
        <span aria-hidden="true" className="text-sm leading-none">⠿</span>
      </button>
      {children}
    </div>
  );
}

function areOrdersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
