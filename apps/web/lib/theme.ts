// Phase 2C — runtime accent application + AA contrast checker.
// Maps an AccentPreset to the HSL channel triplet used by --primary / --ring
// in light and dark modes. Custom accents pass their own h/s/l straight to
// the setter. See globals.css for the legacy alias bridge.

import type { AccentPreset, ThemeAccent } from "@vakwen/shared-types";

export type ResolvedMode = "light" | "dark";

// HSL channel strings ("H S% L%") suitable for direct insertion into the
// `--primary` / `--ring` CSS vars. Status colors do NOT shift with accent —
// they're locked in globals.css.
const PRESETS: Record<AccentPreset, Record<ResolvedMode, { h: number; s: number; l: number }>> = {
  indigo: { light: { h: 238, s: 84, l: 60 }, dark: { h: 238, s: 84, l: 67 } },
  violet: { light: { h: 262, s: 83, l: 58 }, dark: { h: 262, s: 83, l: 65 } },
  blue: { light: { h: 217, s: 91, l: 60 }, dark: { h: 217, s: 91, l: 65 } },
  cyan: { light: { h: 188, s: 86, l: 38 }, dark: { h: 188, s: 86, l: 52 } },
  emerald: { light: { h: 158, s: 64, l: 40 }, dark: { h: 158, s: 64, l: 52 } },
  amber: { light: { h: 35, s: 92, l: 50 }, dark: { h: 35, s: 92, l: 60 } },
  rose: { light: { h: 347, s: 77, l: 50 }, dark: { h: 347, s: 77, l: 62 } },
  slate: { light: { h: 222, s: 47, l: 11 }, dark: { h: 210, s: 40, l: 98 } },
};

interface AccentChannels {
  h: number;
  s: number;
  l: number;
}

function channelsFor(accent: ThemeAccent, mode: ResolvedMode): AccentChannels {
  if (accent.kind === "preset") return PRESETS[accent.preset][mode];
  // Custom: dark-mode bumps lightness by +7 (clamped) so the color stays
  // legible against the darker --background. Light mode uses values as-is.
  if (mode === "dark") {
    return { h: accent.h, s: accent.s, l: Math.min(100, Math.max(0, accent.l + 7)) };
  }
  return { h: accent.h, s: accent.s, l: accent.l };
}

/**
 * Apply `--primary` and `--ring` to <html> via runtime CSS-var setter.
 * Status colors (success/danger/warning) are intentionally not touched.
 * `--primary-foreground` flips between near-white and near-black based on
 * the chosen lightness so contrast remains readable.
 */
export function applyAccent(accent: ThemeAccent, mode: ResolvedMode = "light"): void {
  if (typeof document === "undefined") return;
  const { h, s, l } = channelsFor(accent, mode);
  const root = document.documentElement;
  const triplet = `${h} ${s}% ${l}%`;
  root.style.setProperty("--primary", triplet);
  root.style.setProperty("--ring", triplet);
  // Pick a readable foreground: white on dark primaries, near-black on light.
  const fg = l > 60 ? "222 47% 11%" : "0 0% 100%";
  root.style.setProperty("--primary-foreground", fg);
}

export function applyDensity(density: "compact" | "comfortable"): void {
  if (typeof document === "undefined") return;
  if (density === "comfortable") {
    document.documentElement.dataset.density = "comfortable";
  } else {
    delete document.documentElement.dataset.density;
  }
}

// ─── AA contrast (WCAG relative luminance) ───────────────────────────────
// Used by the custom-color picker to surface a pass/fail badge. Soft-warn
// per Phase 2 spec — UI displays the rating but still allows Apply.

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns whether the accent passes WCAG AA (4.5:1) against BOTH light and
 * dark backgrounds — since the user's actual background depends on theme
 * mode, we check both so the badge is honest regardless of current mode.
 */
export function aaContrastPassesBothModes(accent: ThemeAccent): boolean {
  const lightBg = hslToRgb(0, 0, 100); // --background light: 0 0% 100%
  const darkBg = hslToRgb(222, 47, 6); // --background dark: 222 47% 6%
  const lightFg = hslToRgb(
    channelsFor(accent, "light").h,
    channelsFor(accent, "light").s,
    channelsFor(accent, "light").l,
  );
  const darkFg = hslToRgb(
    channelsFor(accent, "dark").h,
    channelsFor(accent, "dark").s,
    channelsFor(accent, "dark").l,
  );
  return contrastRatio(lightFg, lightBg) >= 4.5 && contrastRatio(darkFg, darkBg) >= 4.5;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = Number.parseInt(m[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
