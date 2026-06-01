"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const ToggleGroupContext = React.createContext<{
  value: string;
  onValueChange: (value: string) => void;
} | null>(null);

type ToggleGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  type?: "single";
  value: string;
  onValueChange: (value: string) => void;
};

function ToggleGroup({
  className,
  value,
  onValueChange,
  type: _type,
  ...props
}: ToggleGroupProps) {
  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange }}>
      <div
        className={cn("inline-flex items-center rounded-lg border border-border bg-muted/40 p-1", className)}
        role="group"
        {...props}
      />
    </ToggleGroupContext.Provider>
  );
}

type ToggleGroupItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

function ToggleGroupItem({
  className,
  value,
  ...props
}: ToggleGroupItemProps) {
  const context = React.useContext(ToggleGroupContext);
  if (!context) {
    throw new Error("ToggleGroupItem must be used within ToggleGroup");
  }

  const pressed = context.value === value;

  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      className={cn(
        "inline-flex min-w-0 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        pressed
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
        className,
      )}
      onClick={() => context.onValueChange(value)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
