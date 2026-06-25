"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { useSidebar } from "../ui/shadcn/sidebar";
import { cn } from "../../lib/utils";
import { getLayoutShellLabels } from "./i18n";

const KEY_RESIZE_STEP_PX = 16;

const MIN_WIDTH_PX = 180;
const MAX_WIDTH_PX = 400;
const DEFAULT_WIDTH_PX = 256;
const STORAGE_KEY = "vakwen-sidebar-width";
const CLICK_THRESHOLD_PX = 4;
const DEFAULT_LABELS = getLayoutShellLabels("en").sidebarResizeRail;

interface SidebarResizeRailProps {
  labels?: {
    ariaLabel?: string;
    expandedTitle?: string;
    collapsedTitle?: string;
  };
}

/**
 * Mutate the SidebarProvider wrapper's `--sidebar-width` CSS variable. The
 * wrapper sets `--sidebar-width: 16rem` inline; we override by writing the
 * same custom property on the wrapper's `style` so the inline-style value
 * is replaced (CSS custom properties cascade like any other property).
 *
 * Returns the previous value (or `null` if unset) so a caller can roll
 * back if it owns the lifecycle.
 */
function setWrapperSidebarWidth(widthPx: number | null): void {
  if (typeof document === "undefined") return;
  const wrapper = document.querySelector<HTMLElement>(".group\\/sidebar-wrapper");
  if (!wrapper) return;
  if (widthPx === null) {
    wrapper.style.removeProperty("--sidebar-width");
  } else {
    wrapper.style.setProperty("--sidebar-width", `${widthPx}px`);
  }
}

function readPersistedWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = Number.parseInt(stored, 10);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < MIN_WIDTH_PX || parsed > MAX_WIDTH_PX) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Custom resize/collapse rail for `<AppSidebar>`.
 *
 * Click → toggleSidebar (collapse/expand), matching shadcn's `<SidebarRail>`.
 * Drag → resize sidebar width between `MIN_WIDTH_PX` and `MAX_WIDTH_PX`.
 * Persists the chosen width to `localStorage` so it survives reloads.
 *
 * The click vs drag distinction is made via a `CLICK_THRESHOLD_PX` movement
 * threshold — any drag that moves the cursor more than the threshold
 * commits to the resize path and bypasses the toggle.
 *
 * Mobile (`<md`): the entire `<Sidebar>` is rendered inside a Radix `Sheet`
 * and this rail is hidden (responsive class `hidden md:flex`).
 */
export function SidebarResizeRail({ labels }: SidebarResizeRailProps) {
  const { toggleSidebar, state, isMobile } = useSidebar();
  const widthRef = useRef<number>(DEFAULT_WIDTH_PX);

  // Restore the persisted width on first mount (post-hydration). A brief
  // flash of the default 16rem is acceptable; the inline-style override
  // commits synchronously inside useLayoutEffect would still race against
  // SSR's default render.
  useEffect(() => {
    const persisted = readPersistedWidth();
    if (persisted !== null) {
      widthRef.current = persisted;
      if (state === "expanded") {
        setWrapperSidebarWidth(persisted);
      }
    }
  }, [state]);

  // When the sidebar collapses, drop the custom width override so shadcn's
  // `--sidebar-width-icon` fallback kicks in cleanly.
  useEffect(() => {
    if (state === "collapsed") {
      setWrapperSidebarWidth(null);
    } else if (widthRef.current !== DEFAULT_WIDTH_PX) {
      setWrapperSidebarWidth(widthRef.current);
    }
  }, [state]);

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    let dragging = false;

    function onMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      if (!dragging && Math.abs(delta) > CLICK_THRESHOLD_PX) {
        dragging = true;
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
      }
      if (!dragging) return;
      const next = Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, startWidth + delta));
      widthRef.current = next;
      setWrapperSidebarWidth(next);
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      if (dragging) {
        try {
          window.localStorage.setItem(STORAGE_KEY, String(widthRef.current));
        } catch {
          // localStorage may be unavailable (privacy mode); width is in
          // memory for the current session — acceptable.
        }
      } else {
        // Pure click — toggle the sidebar like the legacy rail.
        toggleSidebar();
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Enter / Space → toggle (matches click behavior); ←/→ resize in
    // `KEY_RESIZE_STEP_PX` increments so keyboard users can drive the rail.
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (state !== "expanded") return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -KEY_RESIZE_STEP_PX : KEY_RESIZE_STEP_PX;
      const next = Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, widthRef.current + delta));
      widthRef.current = next;
      setWrapperSidebarWidth(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable — width persists for session only.
      }
    }
  }

  if (isMobile) return null;

  return (
    <button
      type="button"
      data-sidebar="rail"
      data-testid="app-sidebar-resize-handle"
      aria-label={labels?.ariaLabel ?? DEFAULT_LABELS.ariaLabel}
      title={state === "collapsed"
        ? (labels?.collapsedTitle ?? DEFAULT_LABELS.collapsedTitle)
        : (labels?.expandedTitle ?? DEFAULT_LABELS.expandedTitle)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        // Position: a vertical strip at the sidebar's right edge.
        "absolute inset-y-0 -right-2 z-20 hidden w-4 sm:flex",
        // Cursor: ew-resize so the affordance is discoverable.
        "cursor-ew-resize",
        // Visual: invisible track with a thin colored bar revealed on hover
        // or keyboard focus. `focus-visible:` keeps the indicator suppressed
        // for mouse users (no ring on click) while ensuring keyboard
        // navigation surfaces a clear focus affordance.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-sidebar-border focus-visible:after:bg-sidebar-border focus-visible:outline-none",
        // When collapsed (state=collapsed), the strip stays visible but
        // becomes a pure click-to-expand affordance (no resize semantic).
        "group-data-[collapsible=offcanvas]:translate-x-0",
      )}
    />
  );
}
