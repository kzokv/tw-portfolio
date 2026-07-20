import type { HoldingsSortDirection, HoldingsSortField } from "@vakwen/shared-types";

export type HoldingsSortPrimitive = number | string | null | undefined;

export interface HoldingsSortIdentity {
  accountId?: string;
  marketCode: string;
  ticker: string;
}

export interface SortHoldingsRowsOptions<Row> {
  direction: HoldingsSortDirection;
  extractKey: (row: Row, field: HoldingsSortField) => HoldingsSortPrimitive;
  field: HoldingsSortField;
  getIdentity: (row: Row) => HoldingsSortIdentity;
  rows: readonly Row[];
}

interface DecoratedHolding<Row> {
  identity: HoldingsSortIdentity;
  key: number | string | null;
  row: Row;
}

export function defaultHoldingsSortDirection(field: HoldingsSortField): HoldingsSortDirection {
  return field === "ticker" ? "asc" : "desc";
}

export function sortHoldingsRows<Row>({
  direction,
  extractKey,
  field,
  getIdentity,
  rows,
}: SortHoldingsRowsOptions<Row>): Row[] {
  const decorated: Array<DecoratedHolding<Row>> = rows.map((row) => ({
    identity: getIdentity(row),
    key: normalizeSortPrimitive(extractKey(row, field)),
    row,
  }));

  decorated.sort((left, right) => {
    const leftMissing = left.key === null;
    const rightMissing = right.key === null;
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (!leftMissing && !rightMissing) {
      const keyComparison = comparePrimitive(left.key!, right.key!);
      if (keyComparison !== 0) return direction === "asc" ? keyComparison : -keyComparison;
    }
    return compareIdentity(left.identity, right.identity);
  });

  return decorated.map((entry) => entry.row);
}

function normalizeSortPrimitive(value: HoldingsSortPrimitive): number | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = value.trim().toUpperCase();
  return normalized === "" ? null : normalized;
}

function comparePrimitive(left: number | string, right: number | string): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function compareIdentity(left: HoldingsSortIdentity, right: HoldingsSortIdentity): number {
  return normalizeIdentityPart(left.ticker).localeCompare(normalizeIdentityPart(right.ticker))
    || normalizeIdentityPart(left.marketCode).localeCompare(normalizeIdentityPart(right.marketCode))
    || normalizeIdentityPart(left.accountId).localeCompare(normalizeIdentityPart(right.accountId));
}

function normalizeIdentityPart(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}
