"use client";

import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/shadcn/sheet";

export function HoldingsDetailSheet<Row>({
  contentClassName = "max-h-[85vh] overflow-y-auto",
  description,
  onOpenChange,
  renderDetail,
  selected,
  title,
}: {
  contentClassName?: string;
  description: ReactNode;
  onOpenChange: (open: boolean) => void;
  renderDetail: (row: Row) => ReactNode;
  selected: Row | null;
  title: ReactNode | ((row: Row) => ReactNode);
}) {
  return (
    <Sheet open={selected !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={contentClassName}>
        <SheetHeader>
          <SheetTitle>{selected ? (typeof title === "function" ? title(selected) : title) : null}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {selected ? renderDetail(selected) : null}
      </SheetContent>
    </Sheet>
  );
}
