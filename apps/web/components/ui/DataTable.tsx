"use client";

// DataTable — Phase 4 wrapper around shadcn Table primitive.
// Single-DOM responsive: scroll + sticky-first-column at <md; optional
// React-conditional card-stack render at <sm (NEVER dual DOM — only one
// rendering exists in DOM at a time, so testids stay unique across
// breakpoints per the Phase 4 scope-todo).
//
// Z-index discipline: stickyFirstColumn uses z-10 (below shadcn Popover /
// Tooltip / Dialog default z-50). Do NOT bump the sticky cell z-index above
// 49 or dropdowns rendered inside it will overlap incorrectly.
//
// Vitest unit-test seam: the wrapper tests assert structural HTML emission
// (rows, sticky class on first cell, slot invocation). Real responsive
// behavior is validated by the Phase 4j mobile-* Playwright specs because
// jsdom does not honor breakpoints.

import * as React from "react";
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/shadcn/table";
import { useIsSmallScreen } from "@/lib/hooks/use-small-screen";
import { cn } from "@/lib/utils";

export type DataTableColumnPriority = "lg" | "md" | "sm";

export interface DataTableColumn<T> {
  /** Stable identifier used as React key. */
  key: string;
  /** Header cell content. */
  header: ReactNode;
  /** Cell render fn for a row. */
  render: (row: T) => ReactNode;
  /** Optional hide-below-breakpoint. `lg` = visible only ≥lg, etc. */
  priority?: DataTableColumnPriority;
  /** Class applied to both <th> and <td> for this column. */
  cellClassName?: string;
  /** Extra <th>-only attrs (aria-sort, scope override). */
  headerProps?: ThHTMLAttributes<HTMLTableCellElement>;
  /** Extra <td>-only attrs callback. */
  cellProps?: (row: T) => TdHTMLAttributes<HTMLTableCellElement>;
}

export interface DataTableProps<T> {
  /** Row data. */
  data: T[];
  /** Column descriptors (left-to-right order). */
  columns: DataTableColumn<T>[];
  /** Stable row key (used for React + testid suffix patterns at consumer). */
  rowKey: (row: T) => string;
  /** Optional className passthrough on the <table>. */
  tableClassName?: string;
  /** Per-row class callback. */
  rowClassName?: (row: T) => string;
  /** Per-row data-testid callback. Returned value goes on the visible row. */
  rowTestId?: (row: T) => string | undefined;
  /** Optional render fn called instead of default columns iteration. Used as
   * an escape hatch (e.g. EditableTransactionRow in TransactionHistoryTable). */
  renderRow?: (row: T) => ReactNode;
  /** Card-stack render below <sm. When provided, on small screens the
   * wrapper renders this list instead of the table. */
  mobileRow?: (row: T) => ReactNode;
  /** Class applied to the per-row <li>-ish wrapper inside the mobile list. */
  mobileItemClassName?: string;
  /** Render `position: sticky` styling on the first column. */
  stickyFirstColumn?: boolean;
  /** Empty-state slot when `data.length === 0`. */
  emptyState?: ReactNode;
  /** data-testid on the table (desktop) / list (mobile) container. */
  "data-testid"?: string;
}

const priorityClass: Record<DataTableColumnPriority, string> = {
  // `lg` = visible only at lg+, hidden below
  lg: "hidden lg:table-cell",
  md: "hidden md:table-cell",
  sm: "hidden sm:table-cell",
};

// Sticky-first-column classes for header + cell. z-10 keeps the sticky cell
// below shadcn floating UI (Popover/Tooltip default z-50).
const STICKY_HEADER_CLASS =
  "sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0";
const STICKY_CELL_CLASS =
  "sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0";

export function DataTable<T>(props: DataTableProps<T>): React.ReactElement {
  const {
    data,
    columns,
    rowKey,
    tableClassName,
    rowClassName,
    rowTestId,
    renderRow,
    mobileRow,
    mobileItemClassName,
    stickyFirstColumn = false,
    emptyState,
  } = props;
  const testId = props["data-testid"];

  const isSmall = useIsSmallScreen();
  const renderMobileCards = !!mobileRow && isSmall;

  if (data.length === 0 && emptyState !== undefined) {
    return (
      <div data-testid={testId} className="w-full">
        {emptyState}
      </div>
    );
  }

  if (renderMobileCards) {
    return (
      <ul
        className="flex flex-col gap-3 sm:hidden"
        data-testid={testId}
        data-datatable-variant="mobile"
      >
        {data.map((row) => {
          const id = rowKey(row);
          const testIdForRow = rowTestId?.(row);
          return (
            <li
              key={id}
              className={cn(mobileItemClassName)}
              data-testid={testIdForRow}
              data-datatable-row="mobile"
            >
              {mobileRow!(row)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Table
      data-testid={testId}
      data-datatable-variant="desktop"
      className={tableClassName}
    >
      <TableHeader>
        <TableRow>
          {columns.map((col, i) => {
            const sticky = stickyFirstColumn && i === 0;
            return (
              <TableHead
                key={col.key}
                className={cn(
                  col.priority && priorityClass[col.priority],
                  sticky && STICKY_HEADER_CLASS,
                  col.cellClassName,
                )}
                {...col.headerProps}
              >
                {col.header}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => {
          const id = rowKey(row);
          const testIdForRow = rowTestId?.(row);
          if (renderRow) {
            return (
              <React.Fragment key={id}>{renderRow(row)}</React.Fragment>
            );
          }
          return (
            <TableRow
              key={id}
              className={rowClassName?.(row)}
              data-testid={testIdForRow}
              data-datatable-row="desktop"
            >
              {columns.map((col, i) => {
                const sticky = stickyFirstColumn && i === 0;
                const extra = col.cellProps?.(row) ?? {};
                return (
                  <TableCell
                    key={col.key}
                    className={cn(
                      col.priority && priorityClass[col.priority],
                      sticky && STICKY_CELL_CLASS,
                      col.cellClassName,
                    )}
                    {...extra}
                  >
                    {col.render(row)}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default DataTable;
