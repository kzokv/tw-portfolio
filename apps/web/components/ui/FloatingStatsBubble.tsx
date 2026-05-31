"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, X } from "lucide-react";

interface FloatingStatsBubbleProps {
  visible: boolean;
  children: React.ReactNode;
}

/**
 * A draggable floating bubble that appears when the inline stats bar scrolls
 * out of view. Click to expand a popover with the stats; click again to collapse.
 * Drag to reposition anywhere on screen.
 */
export function FloatingStatsBubble({ visible, children }: FloatingStatsBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Set initial position (bottom-right corner)
  useEffect(() => {
    if (!initialized && visible) {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setPos({ x: window.innerWidth - 88, y: window.innerHeight - 96 });
      setInitialized(true);
    }
  }, [visible, initialized]);

  // Collapse popover when bubble hides (user scrolled back to top)
  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  // --- Drag handlers ---
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    dragOffset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 56, e.clientX - dragOffset.current.x)),
      y: Math.max(0, Math.min(window.innerHeight - 56, e.clientY - dragOffset.current.y)),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasDragging = dragging.current;
    dragging.current = false;

    // Only toggle expand if it was a click (not a drag)
    const moved = Math.abs(e.clientX - (pos.x + dragOffset.current.x)) > 4 ||
                  Math.abs(e.clientY - (pos.y + dragOffset.current.y)) > 4;
    if (!wasDragging || !moved) {
      setExpanded((prev) => !prev);
    }
  }, [pos]);

  // Keep bubble in viewport on resize
  useEffect(() => {
    function clamp() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setPos((prev) => ({
        x: Math.max(12, Math.min(window.innerWidth - 68, prev.x)),
        y: Math.max(12, Math.min(window.innerHeight - 68, prev.y)),
      }));
    }
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  if (!visible) return null;

  const isMobile = viewport.width > 0 && viewport.width < 640;
  const popoverWidth = Math.min(Math.max(viewport.width - 32, 280), 576);
  const desktopLeft = Math.max(16, Math.min(pos.x + 56 - popoverWidth, viewport.width - popoverWidth - 16));
  const openBelow = pos.y + 360 <= viewport.height - 16;
  const desktopTop = openBelow
    ? Math.min(pos.y + 64, viewport.height - 320)
    : Math.max(16, pos.y - 272);

  return (
    <>
      {/* Bubble */}
      <div
        ref={bubbleRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="group fixed z-50 flex cursor-grab touch-none items-center gap-2 rounded-full bg-primary py-2.5 pl-3.5 pr-4 text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl active:cursor-grabbing"
        style={{ left: pos.x, top: pos.y }}
        data-testid="floating-stats-bubble"
      >
        <BarChart3 className="h-5 w-5 shrink-0" />
        <span className="text-xs font-medium whitespace-nowrap">Click to view stats</span>
      </div>

      {/* Expanded popover */}
      {expanded && (
        <div
          className="fixed z-50 overflow-auto rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          style={isMobile
            ? {
                left: 16,
                right: 16,
                bottom: 88,
                maxHeight: "min(60vh, 32rem)",
              }
            : {
                width: popoverWidth,
                left: desktopLeft,
                top: desktopTop,
                maxHeight: "min(70vh, 32rem)",
              }}
          data-testid="floating-stats-popover"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Position Summary</p>
            <button
              onClick={() => setExpanded(false)}
              className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </>
  );
}
