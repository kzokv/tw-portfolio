/**
 * KZO-196 — Unit tests for the ASX `ASXListedCompanies.csv` parser exposed by
 * `asxGicsCatalog.ts`. QA owns these robustness cases (BOM / CRLF /
 * embedded-comma quoting / case-insensitive headers / missing column).
 *
 * The parser is consumed by:
 *   - `AsxGicsCatalogProvider.fetchGicsCatalog()` (real HTTP fetch path)
 *   - `MockAsxGicsCatalogProvider.fetchGicsCatalog()` (test seam)
 *   - `asxGicsSyncWorker` (worker handler)
 *
 * TDD-RED contract (fails until Backend Implementer lands the module):
 *   - Importing `parseAsxGicsCsv` and `AsxGicsParseError` from
 *     `apps/api/src/services/market-data/providers/asxGicsCatalog.ts`.
 *   - The parser is expected to:
 *       * Locate columns by header name, case-insensitive.
 *       * Throw `AsxGicsParseError({ columnName: "GICS industry group" })`
 *         when the column is missing.
 *       * Strip a leading UTF-8 BOM (U+FEFF) before parsing.
 *       * Handle both LF and CRLF line endings.
 *       * Honor RFC-4180 quoted values (commas inside double-quoted strings).
 *       * Trim whitespace on parsed values; preserve casing.
 *       * Treat the row's ticker column as the ASX code; preserve casing
 *         (CSV producer is upper-case already, but we don't mutate).
 *       * Return `RawAsxGicsRow[]` shape: { ticker, companyName, gicsIndustryGroup }.
 *
 * Suite #4 (apps/api unit). No persistence; pure data tests.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseAsxGicsCsv,
  AsxGicsParseError,
  type RawAsxGicsRow,
} from "../../src/services/market-data/providers/asxGicsCatalog.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  currentDir,
  "../fixtures/asx-listed-companies.sample.csv",
);

describe("KZO-196 — parseAsxGicsCsv", () => {
  describe("happy path — fixture file", () => {
    it("parses the committed sample CSV into RawAsxGicsRow[]", async () => {
      const csv = await fs.readFile(fixturePath, "utf8");
      const rows = parseAsxGicsCsv(csv);

      // Sanity bounds — fixture is ~20 rows per scope-todo.
      expect(rows.length).toBeGreaterThanOrEqual(5);
      expect(rows.length).toBeLessThanOrEqual(60);

      // Every parsed row matches the RawAsxGicsRow shape.
      for (const row of rows) {
        expect(typeof row.ticker).toBe("string");
        expect(row.ticker.length).toBeGreaterThan(0);
        // Ticker is preserved as-is (ASX feed publishes upper-case).
        expect(row.ticker).toBe(row.ticker.trim());
        expect(typeof row.companyName).toBe("string");
        expect(typeof row.gicsIndustryGroup).toBe("string");
      }

      // Tickers are unique within a single CSV.
      const seen = new Set(rows.map((r) => r.ticker));
      expect(seen.size).toBe(rows.length);
    });
  });

  describe("missing GICS industry group column", () => {
    it("throws AsxGicsParseError with the column name attached", () => {
      const csv =
        "ASX code,Company name,Other column\n" +
        "AAA,Alpha Ltd,X\n" +
        "BBB,Beta Ltd,Y\n";

      let caught: unknown = null;
      try {
        parseAsxGicsCsv(csv);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AsxGicsParseError);
      expect((caught as AsxGicsParseError).columnName).toBe(
        "GICS industry group",
      );
    });
  });

  describe("BOM handling", () => {
    it("parses correctly when the file starts with a UTF-8 BOM (U+FEFF)", () => {
      const bom = "﻿";
      const csv =
        bom +
        "ASX code,Company name,GICS industry group\n" +
        "AAA,Alpha Ltd,Banks\n";
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual<RawAsxGicsRow>({
        ticker: "AAA",
        companyName: "Alpha Ltd",
        gicsIndustryGroup: "Banks",
      });
    });
  });

  describe("CRLF line endings", () => {
    it("handles \\r\\n-separated rows", () => {
      const csv =
        "ASX code,Company name,GICS industry group\r\n" +
        "AAA,Alpha Ltd,Banks\r\n" +
        "BBB,Beta Ltd,Materials\r\n";
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0].gicsIndustryGroup).toBe("Banks");
      expect(rows[1].gicsIndustryGroup).toBe("Materials");
    });
  });

  describe("RFC-4180 quoted values", () => {
    it("preserves commas inside double-quoted fields", () => {
      const csv =
        "ASX code,Company name,GICS industry group\n" +
        '"AAA","Alpha, Inc.","Food, Beverage & Tobacco"\n';
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual<RawAsxGicsRow>({
        ticker: "AAA",
        companyName: "Alpha, Inc.",
        gicsIndustryGroup: "Food, Beverage & Tobacco",
      });
    });

    it("supports embedded double-quotes via RFC-4180 doubling", () => {
      const csv =
        "ASX code,Company name,GICS industry group\n" +
        '"AAA","Alpha ""The"" Co","Banks"\n';
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].companyName).toBe('Alpha "The" Co');
    });
  });

  describe("case-insensitive header matching", () => {
    it("matches `gics industry group` (lowercase)", () => {
      const csv =
        "asx code,company name,gics industry group\n" +
        "AAA,Alpha Ltd,Banks\n";
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].gicsIndustryGroup).toBe("Banks");
    });

    it("matches `GICS Industry Group` (title case)", () => {
      const csv =
        "ASX Code,Company Name,GICS Industry Group\n" +
        "AAA,Alpha Ltd,Banks\n";
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].gicsIndustryGroup).toBe("Banks");
    });
  });

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace on field values", () => {
      const csv =
        "ASX code,Company name,GICS industry group\n" +
        "  AAA  ,  Alpha Ltd  ,  Banks  \n";
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual<RawAsxGicsRow>({
        ticker: "AAA",
        companyName: "Alpha Ltd",
        gicsIndustryGroup: "Banks",
      });
    });

    it("preserves internal whitespace inside fields", () => {
      const csv =
        "ASX code,Company name,GICS industry group\n" +
        "AAA,Alpha Ltd,Banks  Diversified\n";
      const rows = parseAsxGicsCsv(csv);
      expect(rows[0].gicsIndustryGroup).toBe("Banks  Diversified");
    });
  });

  describe("empty input", () => {
    // Per Architect: default expectation is throw (matches missing-column
    // failure-loud semantic). If Backend's contract is "return [] on empty",
    // QA can downgrade — coordinate via [QUESTION] at convergence.
    it("throws AsxGicsParseError for an empty file (no header row)", () => {
      const csv = "";
      let caught: unknown = null;
      try {
        parseAsxGicsCsv(csv);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AsxGicsParseError);
    });

    it("returns an empty array when the file has only a valid header (zero data rows)", () => {
      const csv = "ASX code,Company name,GICS industry group\n";
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toEqual([]);
    });
  });

  describe("live ASX feed prefix shape", () => {
    // Regression: live ASX feed (verified 2026-05-09) prefixes the CSV with a
    // plain-text descriptive line + blank line BEFORE the real header row.
    // Those leading lines are NOT `#`-prefixed, so csv-parse's `comment`
    // option does not strip them. The parser must skip leading non-header
    // lines until it reaches the real header.
    it("strips a leading descriptive line + blank line before the real header", () => {
      const csv = [
        "ASX listed companies as at Sat May 09 21:33:05 AEST 2026",
        "",
        "Company name,ASX code,GICS industry group",
        '"1414 DEGREES LIMITED","14D","Capital Goods"',
        '"29METALS LIMITED","29M","Materials"',
      ].join("\n");
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toEqual<RawAsxGicsRow[]>([
        {
          ticker: "14D",
          companyName: "1414 DEGREES LIMITED",
          gicsIndustryGroup: "Capital Goods",
        },
        {
          ticker: "29M",
          companyName: "29METALS LIMITED",
          gicsIndustryGroup: "Materials",
        },
      ]);
    });

    it("handles the live shape with CRLF line endings", () => {
      const csv = [
        "ASX listed companies as at Sat May 09 21:33:05 AEST 2026",
        "",
        "Company name,ASX code,GICS industry group",
        '"1414 DEGREES LIMITED","14D","Capital Goods"',
      ].join("\r\n");
      const rows = parseAsxGicsCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        ticker: "14D",
        companyName: "1414 DEGREES LIMITED",
        gicsIndustryGroup: "Capital Goods",
      });
    });
  });
});
