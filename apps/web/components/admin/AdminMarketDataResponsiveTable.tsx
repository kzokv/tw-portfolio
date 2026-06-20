"use client";

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/shadcn/table";
import { cn } from "../../lib/utils";
import { useIsSmallScreen } from "../../lib/hooks/use-small-screen";
import {
  HoldingsColumnHeaderContent,
  HoldingsColumnSettingsMenu,
  holdingsColumnCellStyle,
  useHoldingsColumnSettings,
  type HoldingsColumnSettingsCopy,
  type HoldingsGridColumnDefinition,
} from "../holdings/HoldingsColumnSettings";

const STICKY_HEADER_CLASS = "sticky left-0 z-10 border-r border-border bg-muted/30";
const STICKY_CELL_CLASS = "sticky left-0 z-10 border-r border-border bg-card";

export interface AdminMarketDataResponsiveColumn<Row, ColumnId extends string> extends HoldingsGridColumnDefinition<ColumnId> {
  renderCell: (row: Row) => ReactNode;
  renderCardValue?: (row: Row) => ReactNode;
  summaryLabel?: string;
}

interface AdminMarketDataResponsiveTableProps<Row, ColumnId extends string> {
  columns: Array<AdminMarketDataResponsiveColumn<Row, ColumnId>>;
  rows: Row[];
  contextKey: string;
  emptyMessage: string;
  footer?: ReactNode;
  rowKey: (row: Row) => string;
  rowTestId?: (row: Row) => string;
  selectedRowKey?: string | null;
  onRowSelect: (row: Row) => void;
  settingsCopy: Partial<HoldingsColumnSettingsCopy>;
  tableTestId: string;
  desktopMinWidthClassName?: string;
  defaultHiddenColumns?: ColumnId[];
  defaultMobileSummaryCount?: number;
  toolbar?: ReactNode;
  getCardIdentity: (row: Row) => {
    title: ReactNode;
    subtitle?: ReactNode;
    badge?: ReactNode;
  };
}

export function AdminMarketDataResponsiveTable<Row, ColumnId extends string>({
  columns,
  rows,
  contextKey,
  emptyMessage,
  footer,
  rowKey,
  rowTestId,
  selectedRowKey = null,
  onRowSelect,
  settingsCopy,
  tableTestId,
  desktopMinWidthClassName = "min-w-[64rem]",
  defaultHiddenColumns,
  defaultMobileSummaryCount = 3,
  toolbar,
  getCardIdentity,
}: AdminMarketDataResponsiveTableProps<Row, ColumnId>) {
  const isSmallScreen = useIsSmallScreen();
  const [isHydrated, setIsHydrated] = useState(false);
  const identityColumn = columns[0];
  const mobileSummaryColumnIds = useMemo(
    () => columns.slice(1).map((column) => column.id),
    [columns],
  );
  const pinnedLeadingColumns = useMemo<ColumnId[]>(() => (identityColumn ? [identityColumn.id] : []), [identityColumn]);
  const settings = useHoldingsColumnSettings({
    columns,
    contextKey,
    defaultHiddenColumns,
    defaultMobileSummaryCount,
    mobileSummaryColumnIds,
    pinnedLeadingColumns,
    preferenceNamespace: "adminMarketDataTableSettings",
  });
  const visibleColumns = settings.orderedColumns
    .map((column) => columns.find((entry) => entry.id === column.id))
    .filter((column): column is AdminMarketDataResponsiveColumn<Row, ColumnId> => (
      column !== undefined && settings.visibleColumns.includes(column.id)
    ));
  const summaryColumns = visibleColumns.filter((column) => column.id !== identityColumn?.id).slice(0, settings.mobileSummaryCount);
  function handleDesktopRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: Row) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRowSelect(row);
  }

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (!identityColumn) return null;

  return (
    <div className="min-w-0" data-hydrated={isHydrated ? "true" : "false"}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <HoldingsColumnSettingsMenu
          copy={settingsCopy}
          settings={settings}
          testIdPrefix="admin-market-data"
        />
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted-foreground" data-testid={`${tableTestId}-empty`}>
          {emptyMessage}
        </div>
      ) : isSmallScreen ? (
        <div className="space-y-3 px-4 py-4" data-testid={tableTestId}>
          {rows.map((row) => {
            const key = rowKey(row);
            const identity = getCardIdentity(row);
            const cardContent = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words font-medium text-foreground">{identity.title}</div>
                    {identity.subtitle ? <div className="mt-1 text-sm text-muted-foreground">{identity.subtitle}</div> : null}
                  </div>
                  {identity.badge ? <div className="shrink-0">{identity.badge}</div> : null}
                </div>
                {summaryColumns.length > 0 ? (
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    {summaryColumns.map((column) => (
                      <div key={`${key}:${column.id}`} className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{column.summaryLabel ?? column.label}</dt>
                        <dd className="mt-1 break-words text-sm text-foreground">{column.renderCardValue?.(row) ?? column.renderCell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </>
            );
            const cardClassName = cn(
              "w-full rounded-xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/20",
              selectedRowKey === key && "border-primary/45 bg-primary/5",
            );
            return (
              <button
                key={key}
                type="button"
                className={cardClassName}
                onClick={() => onRowSelect(row)}
                data-testid={rowTestId?.(row)}
              >
                {cardContent}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <Table className={cn("w-max min-w-full divide-y divide-border text-sm", desktopMinWidthClassName)} data-testid={tableTestId}>
            <TableHeader className="bg-muted/30 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <TableRow>
                {visibleColumns.map((column, index) => (
                  <TableHead
                    key={column.id}
                    className={cn(index === 0 && STICKY_HEADER_CLASS)}
                    style={holdingsColumnCellStyle(settings, column.id)}
                  >
                    <HoldingsColumnHeaderContent
                      column={column.id}
                      copy={settingsCopy}
                      label={column.label}
                      settings={settings}
                      testIdPrefix="admin-market-data"
                    />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border">
              {rows.map((row) => {
                const key = rowKey(row);
                return (
                  <TableRow
                    key={key}
                    className={cn(
                      "cursor-pointer align-top outline-none hover:bg-muted/20 focus-visible:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      selectedRowKey === key && "bg-muted/20",
                    )}
                    tabIndex={0}
                    role="button"
                    aria-selected={selectedRowKey === key}
                    onClick={() => onRowSelect(row)}
                    onKeyDown={(event) => handleDesktopRowKeyDown(event, row)}
                    data-testid={rowTestId?.(row)}
                  >
                    {visibleColumns.map((column, index) => (
                      <TableCell
                        key={`${key}:${column.id}`}
                        className={cn(index === 0 && STICKY_CELL_CLASS)}
                        style={holdingsColumnCellStyle(settings, column.id)}
                      >
                        {column.renderCell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {footer ? <div className="border-t border-border px-5 py-4">{footer}</div> : null}
    </div>
  );
}
