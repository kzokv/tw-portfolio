import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SORT_FIELDS = [
  "ticker",
  "accountCount",
  "quantity",
  "averageCost",
  "price",
  "unitPnl",
  "marketValue",
  "costBasis",
  "dailyChangePercent",
  "unrealizedPnl",
  "allocation",
  "dataHealth",
  "nextDividendDate",
  "lastDividendDate",
] as const;

type Field = (typeof SORT_FIELDS)[number];
type Direction = "asc" | "desc";
type SortKey = number | string | null;

interface Row {
  accountId: string;
  keys: Record<Field, SortKey>;
  marketCode: string;
  ticker: string;
}

interface SortingModule {
  defaultHoldingsSortDirection(field: Field): Direction;
  sortHoldingsRows<RowType>(args: {
    direction: Direction;
    extractKey: (row: RowType, field: Field) => SortKey;
    field: Field;
    getIdentity: (row: RowType) => { accountId?: string; marketCode: string; ticker: string };
    rows: readonly RowType[];
  }): RowType[];
}

describe("shared holdings sorting engine", () => {
  it.each(SORT_FIELDS)("sorts %s in both directions with missing values last", async (field) => {
    const sorting = await loadSortingModule();
    const rows = fixtureRows(field);
    const ascending = sorting.sortHoldingsRows({
      direction: "asc",
      extractKey: (row: Row, activeField) => row.keys[activeField],
      field,
      getIdentity,
      rows,
    });
    const descending = sorting.sortHoldingsRows({
      direction: "desc",
      extractKey: (row: Row, activeField) => row.keys[activeField],
      field,
      getIdentity,
      rows,
    });

    expect(ascending.map((row) => row.ticker)).toEqual(["LOW", "HIGH", "MISSING"]);
    expect(descending.map((row) => row.ticker)).toEqual(["HIGH", "LOW", "MISSING"]);
  });

  it("extracts one key per row, keeps the source immutable, and orders deterministic ties by ticker/market/account", async () => {
    const sorting = await loadSortingModule();
    const rows = [
      row("BBB", "US", "account-b", 10),
      row("AAA", "US", "account-c", 10),
      row("AAA", "TW", "account-a", 10),
      row("AAA", "TW", "account-b", 10),
    ];
    const sourceSnapshot = rows.slice();
    let extractionCount = 0;
    const sorted = sorting.sortHoldingsRows({
      direction: "asc",
      extractKey: (value: Row, field: Field) => {
        extractionCount += 1;
        return value.keys[field];
      },
      field: "marketValue",
      getIdentity,
      rows,
    });

    expect(extractionCount).toBe(rows.length);
    expect(rows).toEqual(sourceSnapshot);
    expect(sorted.map((value) => `${value.ticker}:${value.marketCode}:${value.accountId}`)).toEqual([
      "AAA:TW:account-a",
      "AAA:TW:account-b",
      "AAA:US:account-c",
      "BBB:US:account-b",
    ]);
  });

  it("treats NaN and infinities as unavailable in both directions", async () => {
    const sorting = await loadSortingModule();
    const rows = [row("FINITE", "US", "a", 1), row("NAN", "US", "b", Number.NaN), row("INF", "US", "c", Infinity)];
    for (const direction of ["asc", "desc"] as const) {
      const sorted = sorting.sortHoldingsRows({
        direction,
        extractKey: (value: Row, field: Field) => value.keys[field],
        field: "price",
        getIdentity,
        rows,
      });
      expect(sorted[0]?.ticker).toBe("FINITE");
      expect(sorted.slice(1).map((value) => value.ticker)).toEqual(["INF", "NAN"]);
    }
  });

  it("uses ascending for text and descending for numeric, health, and ISO date fields", async () => {
    const sorting = await loadSortingModule();
    expect(sorting.defaultHoldingsSortDirection("ticker")).toBe("asc");
    for (const field of SORT_FIELDS.filter((candidate) => candidate !== "ticker")) {
      expect(sorting.defaultHoldingsSortDirection(field)).toBe("desc");
    }
  });
});

async function loadSortingModule(): Promise<SortingModule> {
  const webRoot = existsSync(join(process.cwd(), "components")) ? process.cwd() : join(process.cwd(), "apps", "web");
  const modulePath = pathToFileURL(join(webRoot, "components", "holdings", "holdingsSorting.ts")).href;
  return await import(/* @vite-ignore */ modulePath) as SortingModule;
}

function fixtureRows(field: Field): Row[] {
  const low: SortKey = field === "ticker" ? "AAA" : field.includes("Date") ? "2026-01-01" : field === "dataHealth" ? 0x00000000 : 1;
  const high: SortKey = field === "ticker" ? "ZZZ" : field.includes("Date") ? "2026-12-31" : field === "dataHealth" ? 0x03020401 : 2;
  return [row("MISSING", "US", "c", null, field), row("HIGH", "US", "b", high, field), row("LOW", "US", "a", low, field)];
}

function row(ticker: string, marketCode: string, accountId: string, key: SortKey, field: Field = "marketValue"): Row {
  return {
    accountId,
    keys: Object.fromEntries(SORT_FIELDS.map((candidate) => [candidate, candidate === field ? key : 0])) as Record<Field, SortKey>,
    marketCode,
    ticker,
  };
}

function getIdentity(value: Row) {
  return { accountId: value.accountId, marketCode: value.marketCode, ticker: value.ticker };
}
