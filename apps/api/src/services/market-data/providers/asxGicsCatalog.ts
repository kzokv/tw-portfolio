/**
 * KZO-196 — ASX GICS catalog provider.
 *
 * Fetches the public ASX listed-companies CSV
 * (`https://www.asx.com.au/asx/research/ASXListedCompanies.csv`) and parses
 * each row into `{ ticker, companyName, gicsIndustryGroup }`. Used by the
 * `asx-gics-sync` pg-boss worker to enrich `market_data.instruments` rows
 * with their GICS industry-group label (per KZO-196).
 *
 * **Distinct from `TwelveDataAuCatalogProvider`** — this provider does NOT
 * implement `InstrumentCatalogProvider`, never enumerates instruments, and is
 * not registered in `marketDataRegistry.catalog`. Its sole purpose is GICS
 * enrichment via UPDATEs to existing AU rows.
 *
 * **Header lookup is case-insensitive** but the column names ASX publishes
 * (verified 2026-05) are:
 *   - `ASX code`
 *   - `Company name`
 *   - `GICS industry group`
 *
 * Missing column → `AsxGicsParseError({ columnName })`. HTTP/network failure
 * → `AsxGicsFetchError`. Both are typed so the worker can distinguish from
 * generic transient errors and route to the per-stage log lines documented
 * in the scope-todo.
 *
 * Per `.claude/rules/typed-transient-error-catch-audit.md`: the worker that
 * consumes this provider MUST re-throw `RateLimitedError` first if any
 * future change introduces upstream rate-limiting. The current ASX feed has
 * no documented quota, so no `RateLimiter` is wired here.
 */
import { parse as csvParseSync } from "csv-parse/sync";

const DEFAULT_CSV_URL =
  "https://www.asx.com.au/asx/research/ASXListedCompanies.csv";
const DEFAULT_TIMEOUT_MS = 30_000;

const COL_TICKER_KEYS = ["asx code", "asx_code", "code", "ticker"] as const;
const COL_NAME_KEYS = ["company name", "company_name", "name"] as const;
const COL_GICS_KEYS = [
  "gics industry group",
  "gics_industry_group",
  "industry group",
] as const;

/** Output row shape for the ASX GICS feed. All three fields are non-empty strings. */
export interface RawAsxGicsRow {
  ticker: string;
  companyName: string;
  gicsIndustryGroup: string;
}

/** Throws when an expected CSV column is missing. */
export class AsxGicsParseError extends Error {
  public readonly columnName: string;
  constructor(columnName: string, message?: string) {
    super(message ?? `asx_gics_csv_missing_column: ${columnName}`);
    this.name = "AsxGicsParseError";
    this.columnName = columnName;
  }
}

/** Throws on HTTP / network failures fetching the ASX CSV. */
export class AsxGicsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsxGicsFetchError";
  }
}

export interface AsxGicsProvider {
  readonly providerId: "asx-gics-csv";
  fetchGicsCatalog(): Promise<RawAsxGicsRow[]>;
}

/**
 * Pure parser — exported for unit tests so the parsing logic can be exercised
 * against a committed sample CSV without any HTTP. Strips a UTF-8 BOM if
 * present, accepts both LF and CRLF line endings, and tolerates embedded-comma
 * quoted fields per RFC 4180. Returns rows where all three columns are
 * non-empty (rows missing any required value are silently skipped — preserves
 * the worker's "leave-stale on absence" invariant for malformed entries).
 */
export function parseAsxGicsCsv(text: string): RawAsxGicsRow[] {
  if (text.trim().length === 0) {
    throw new AsxGicsParseError(
      "ASX code",
      "asx_gics_csv_empty_input: no header row present",
    );
  }

  // The live ASX feed (verified 2026-05-09) prefixes the CSV with a plain-text
  // descriptive line (`ASX listed companies as at <date>`) followed by a blank
  // line BEFORE the real header row. Those leading lines are not `#`-prefixed,
  // so `csv-parse`'s `comment` option does not strip them. Without preprocessing
  // they get parsed as a 1-column header row and the column lookup below fails
  // with `asx_gics_csv_missing_column: ASX code`. Strip leading lines until we
  // reach the first one that looks like the real header (contains a comma AND a
  // recognized header token).
  const HEADER_HINT = /\b(asx[_ ]?code|company[_ ]?name)\b/i;
  const stripped = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let headerIdx = 0;
  while (headerIdx < stripped.length) {
    const line = stripped[headerIdx].trim();
    if (line.length > 0 && line.includes(",") && HEADER_HINT.test(line)) break;
    headerIdx += 1;
  }
  const normalized =
    headerIdx < stripped.length ? stripped.slice(headerIdx).join("\n") : text;

  // `csv-parse/sync` honors BOM stripping when `bom: true`. CRLF is handled
  // automatically. We capture the normalized (lowercase, trimmed) header in
  // a closure variable so missing-column detection works even on header-only
  // files (zero data rows).
  let normalizedHeader: string[] = [];
  let rows: Record<string, string>[];
  try {
    rows = csvParseSync(normalized, {
      bom: true,
      columns: (header: string[]) => {
        normalizedHeader = header.map((h) => h.trim().toLowerCase());
        return normalizedHeader;
      },
      // Test fixtures use `#`-prefixed comment lines for documentation; the
      // live feed uses plain-text descriptive prefix lines (stripped above).
      // Keeping `comment: "#"` keeps fixtures parseable.
      comment: "#",
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new AsxGicsParseError(
      "<unparseable>",
      `asx_gics_csv_parse_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const headerKeys = new Set(normalizedHeader);
  const tickerKey = COL_TICKER_KEYS.find((k) => headerKeys.has(k));
  const nameKey = COL_NAME_KEYS.find((k) => headerKeys.has(k));
  const gicsKey = COL_GICS_KEYS.find((k) => headerKeys.has(k));

  if (!tickerKey) throw new AsxGicsParseError("ASX code");
  if (!nameKey) throw new AsxGicsParseError("Company name");
  if (!gicsKey) throw new AsxGicsParseError("GICS industry group");

  if (rows.length === 0) return [];

  const out: RawAsxGicsRow[] = [];
  for (const row of rows) {
    const ticker = (row[tickerKey] ?? "").trim();
    const companyName = (row[nameKey] ?? "").trim();
    const gicsIndustryGroup = (row[gicsKey] ?? "").trim();
    if (!ticker || !companyName || !gicsIndustryGroup) continue;
    out.push({ ticker, companyName, gicsIndustryGroup });
  }
  return out;
}

export interface AsxGicsCatalogProviderConfig {
  /** Override the source URL — primarily for tests pointing at a local fixture server. */
  csvUrl?: string;
  /** HTTP request timeout (ms). Defaults to 30s — ASX CSV is ~150KB, comfortably fast. */
  timeoutMs?: number;
}

export class AsxGicsCatalogProvider implements AsxGicsProvider {
  readonly providerId = "asx-gics-csv";
  private readonly csvUrl: string;
  private readonly timeoutMs: number;

  constructor(config: AsxGicsCatalogProviderConfig = {}) {
    this.csvUrl = config.csvUrl ?? DEFAULT_CSV_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchGicsCatalog(): Promise<RawAsxGicsRow[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.csvUrl, { signal: controller.signal });
    } catch (err) {
      throw new AsxGicsFetchError(
        `asx_gics_fetch_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AsxGicsFetchError(
        `asx_gics_http_error: ${res.status} ${res.statusText}`,
      );
    }
    const text = await res.text();
    return parseAsxGicsCsv(text);
  }
}
