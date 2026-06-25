"use client";

// Phase 2B — 3-state segmented control: ☀ Light · 🌓 System · 🌙 Dark.
// Reads / writes via next-themes. Theme MODE persists per-device
// (localStorage key "vakwen-theme" — set in ThemeProvider config).
// Locked testids per phase-2-spec §5.

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/utils";
import { getLayoutShellLabels } from "./i18n";

const DEFAULT_LABELS = getLayoutShellLabels("en").themeToggle;

interface ThemeToggleProps {
  className?: string;
  /** When true (default in TopBar), render icon-only buttons. */
  iconOnly?: boolean;
  labels?: {
    groupLabel?: string;
    light?: string;
    system?: string;
    dark?: string;
  };
}

export function ThemeToggle({ className, iconOnly = true, labels }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — next-themes resolves the theme client-side.
  useEffect(() => {
    setMounted(true);
  }, []);

  const active = (mounted ? theme : "system") ?? "system";
  const options = [
    { value: "light" as const, label: labels?.light ?? DEFAULT_LABELS.light, Icon: Sun },
    { value: "system" as const, label: labels?.system ?? DEFAULT_LABELS.system, Icon: Monitor },
    { value: "dark" as const, label: labels?.dark ?? DEFAULT_LABELS.dark, Icon: Moon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={labels?.groupLabel ?? DEFAULT_LABELS.groupLabel}
      className={cn(
        "inline-flex h-9 items-center rounded-full border border-border bg-card p-0.5 shadow-sm",
        className,
      )}
      data-testid="theme-toggle"
    >
      {options.map(({ value, label, Icon }) => {
        const on = active === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            title={label}
            aria-label={label}
            onClick={() => setTheme(value)}
            data-testid={`theme-toggle-${value}`}
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-full px-2 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {!iconOnly && <span className="ml-1.5">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
