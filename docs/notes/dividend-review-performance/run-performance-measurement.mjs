import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { chromium } from "@playwright/test";

const samples = Number(process.env.PERF_SAMPLES ?? 20);
const webBaseUrl = process.env.PERF_WEB_URL ?? "http://localhost:3777";
const apiBaseUrl = process.env.PERF_API_URL ?? "http://localhost:4400";
const outputDir = new URL("./evidence/", import.meta.url);
const baseQuery = "view=ledger&preset=yearRange&fromPaymentDate=2020-01-01&toPaymentDate=2026-12-31&page=1&limit=10";
const defaultSortFields = [
  "paymentDate", "ticker", "account", "expectedGrossAmount", "receivedCashAmount", "nhiAmount",
  "bankFeeAmount", "otherDeductionAmount", "expectedNetAmount", "actualNetAmount", "varianceAmount",
  "reconciliationStatus",
];
const sortFields = process.env.PERF_SORT_FIELDS
  ? process.env.PERF_SORT_FIELDS.split(",").map((field) => field.trim()).filter(Boolean)
  : defaultSortFields;

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(values) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    medianMs: percentile(finite, 0.5),
    p95Ms: percentile(finite, 0.95),
    maxMs: finite.length ? Math.max(...finite) : null,
  };
}

function parseServerTiming(value) {
  const entries = {};
  for (const segment of (value ?? "").split(",")) {
    const [name, ...parameters] = segment.trim().split(";");
    if (!name) continue;
    const duration = parameters.map((item) => item.trim()).find((item) => item.startsWith("dur="));
    entries[name] = duration ? Number(duration.slice(4)) : null;
  }
  return entries;
}

async function apiSample(path) {
  const started = performance.now();
  const response = await fetch(`${apiBaseUrl}${path}`, { headers: { "x-user-id": "user-1" } });
  const body = await response.json();
  const elapsedMs = performance.now() - started;
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return {
    elapsedMs,
    serverTimingRaw: response.headers.get("server-timing"),
    serverTiming: parseServerTiming(response.headers.get("server-timing")),
    rowIds: Array.isArray(body.reviewRows) ? body.reviewRows.map((row) => row.id) : undefined,
    total: body.total,
  };
}

async function visibleRowIds(page) {
  return page.locator('[data-testid^="review-row-"]:not([data-testid="review-row-skeleton"])')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")?.slice("review-row-".length) ?? ""));
}

async function installWrongFrameProbe(page, oldIds) {
  await page.evaluate((ids) => {
    window.__reviewPerfProbe = {
      oldIds: ids,
      oldHref: location.href,
      wrongFrames: 0,
      frames: 0,
      active: true,
      actionStarted: false,
      startedAt: 0,
      feedbackMs: null,
      commitMs: null,
      trace: [],
    };
    const markAction = () => {
      const probe = window.__reviewPerfProbe;
      if (!probe?.active || probe.actionStarted) return;
      probe.actionStarted = true;
      probe.startedAt = performance.now();
      probe.oldHref = location.href;
      probe.trace = [];
    };
    document.addEventListener("click", markAction, { capture: true, once: true });
    document.addEventListener("change", markAction, { capture: true, once: true });
    const inspectFeedback = () => {
      const probe = window.__reviewPerfProbe;
      if (!probe?.active || !probe.actionStarted || probe.feedbackMs !== null) return;
      const busy = [...document.querySelectorAll('[data-testid="review-table"]')]
        .some((table) => table.getAttribute("aria-busy") === "true");
      const hasSkeleton = document.querySelector('[data-testid="review-row-skeleton"]') !== null;
      if (busy || hasSkeleton) probe.feedbackMs = performance.now() - probe.startedAt;
    };
    window.__reviewPerfProbe.observer = new MutationObserver(inspectFeedback);
    window.__reviewPerfProbe.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-busy"],
      childList: true,
      subtree: true,
    });
    const tick = () => {
      const probe = window.__reviewPerfProbe;
      if (!probe?.active) return;
      if (!probe.actionStarted) {
        requestAnimationFrame(tick);
        return;
      }
      probe.frames += 1;
      const busy = [...document.querySelectorAll('[data-testid="review-table"]')]
        .some((table) => table.getAttribute("aria-busy") === "true");
      const hasSkeleton = document.querySelector('[data-testid="review-row-skeleton"]') !== null;
      if (probe.feedbackMs === null && (busy || hasSkeleton)) probe.feedbackMs = performance.now() - probe.startedAt;
      const current = [...document.querySelectorAll('[data-testid^="review-row-"]')]
        .map((row) => row.getAttribute("data-testid")?.slice("review-row-".length) ?? "")
        .filter((id) => id !== "skeleton");
      const hrefChanged = location.href !== probe.oldHref;
      const oldRowsVisible = current.length > 0 && current.join("|") === probe.oldIds.join("|");
      if (hrefChanged && !busy && !hasSkeleton && oldRowsVisible) probe.wrongFrames += 1;
      if (probe.commitMs === null && hrefChanged && !busy && !hasSkeleton && !oldRowsVisible && current.length > 0) {
        probe.commitMs = performance.now() - probe.startedAt;
      }
      const snapshot = { atMs: performance.now() - probe.startedAt, hrefChanged, busy, hasSkeleton, oldRowsVisible };
      const previous = probe.trace.at(-1);
      if (!previous || previous.hrefChanged !== snapshot.hrefChanged || previous.busy !== snapshot.busy
        || previous.hasSkeleton !== snapshot.hasSkeleton || previous.oldRowsVisible !== snapshot.oldRowsVisible) {
        probe.trace.push(snapshot);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, oldIds);
}

async function finishWrongFrameProbe(page) {
  return page.evaluate(() => {
    if (!window.__reviewPerfProbe) return { wrongFrames: 0, frames: 0, feedbackMs: null };
    window.__reviewPerfProbe.active = false;
    window.__reviewPerfProbe.observer?.disconnect();
    return {
      wrongFrames: window.__reviewPerfProbe.wrongFrames,
      frames: window.__reviewPerfProbe.frames,
      feedbackMs: window.__reviewPerfProbe.feedbackMs,
      commitMs: window.__reviewPerfProbe.commitMs,
      elapsedMs: window.__reviewPerfProbe.actionStarted
        ? performance.now() - window.__reviewPerfProbe.startedAt
        : null,
      trace: window.__reviewPerfProbe.trace,
    };
  });
}

async function measureInteraction(page, action, responsePredicate) {
  const beforeIds = await visibleRowIds(page);
  await installWrongFrameProbe(page, beforeIds);
  const responsePromise = page.waitForResponse(responsePredicate);
  await action();
  const response = await responsePromise;
  const body = await response.json();
  const expectedIds = body.reviewRows.map((row) => row.id);
  await page.waitForFunction((ids) => {
    const current = [...document.querySelectorAll('[data-testid^="review-row-"]:not([data-testid="review-row-skeleton"])')]
      .map((row) => row.getAttribute("data-testid")?.slice("review-row-".length) ?? "");
    return current.join("|") === ids.join("|");
  }, expectedIds);
  const probe = await finishWrongFrameProbe(page);
  const identityActuallyChanged = beforeIds.join("|") !== expectedIds.join("|");
  return {
    visibleMs: probe.commitMs ?? probe.elapsedMs,
    feedbackMs: probe.feedbackMs,
    serverTimingRaw: response.headers()["server-timing"] ?? null,
    serverTiming: parseServerTiming(response.headers()["server-timing"]),
    beforeIds,
    afterIds: await visibleRowIds(page),
    responseIds: expectedIds,
    wrongQueryFrames: identityActuallyChanged ? probe.wrongFrames : 0,
    observedFrames: probe.frames,
    trace: probe.trace,
  };
}

async function measureCachedInteraction(page, action, expectedIds) {
  const beforeIds = await visibleRowIds(page);
  await installWrongFrameProbe(page, beforeIds);
  await action();
  await page.waitForFunction((ids) => {
    const current = [...document.querySelectorAll('[data-testid^="review-row-"]:not([data-testid="review-row-skeleton"])')]
      .map((row) => row.getAttribute("data-testid")?.slice("review-row-".length) ?? "");
    return current.join("|") === ids.join("|");
  }, expectedIds);
  const probe = await finishWrongFrameProbe(page);
  const identityActuallyChanged = beforeIds.join("|") !== expectedIds.join("|");
  return {
    visibleMs: probe.commitMs ?? probe.elapsedMs,
    feedbackMs: probe.feedbackMs,
    serverTimingRaw: null,
    serverTiming: {},
    beforeIds,
    afterIds: await visibleRowIds(page),
    responseIds: expectedIds,
    wrongQueryFrames: identityActuallyChanged ? probe.wrongFrames : 0,
    observedFrames: probe.frames,
    trace: probe.trace,
    exactCacheHit: true,
  };
}

async function openReview(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const enrichmentResponses = [];
  page.on("response", async (response) => {
    if (response.url().includes("/portfolio/dividends/review/enrichment")) {
      enrichmentResponses.push({
        elapsedAtMs: performance.now(),
        serverTimingRaw: response.headers()["server-timing"] ?? null,
        serverTiming: parseServerTiming(response.headers()["server-timing"]),
      });
    }
  });
  const started = performance.now();
  await page.goto(`${webBaseUrl}/dividends?${baseQuery}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="review-table"]').waitFor({ state: "visible" });
  await page.locator('[data-testid^="review-row-"]:not([data-testid="review-row-skeleton"])').first().waitFor();
  const tableUsableMs = performance.now() - started;
  return { context, page, tableUsableMs, enrichmentResponses, started };
}

const raw = {
  metadata: {
    generatedAt: new Date().toISOString(),
    samplesPerScenario: samples,
    webBaseUrl,
    apiBaseUrl,
    node: process.version,
    operatingSystem: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    commit: process.env.PERF_COMMIT ?? "unknown",
    database: process.env.PERF_DATABASE_LABEL ?? "isolated-local-postgres",
    runtime: "compiled API plus production-built Next standalone",
  },
  api: {},
  browser: { coldLoad: [], sorts: {}, pagination: [], pageSizes: {}, filter: [] },
};

for (const field of sortFields) {
  for (const order of ["asc", "desc"]) {
    const key = `${field}:${order}`;
    raw.api[key] = [];
    const path = `/portfolio/dividends/review/primary?fromPaymentDate=2020-01-01&toPaymentDate=2026-12-31&sortBy=${field}&sortOrder=${order}&page=1&limit=10`;
    await apiSample(path); // warm-up excluded
    for (let index = 0; index < samples; index += 1) raw.api[key].push(await apiSample(path));
  }
}

raw.api.enrichmentFilter = [];
const enrichmentPath = "/portfolio/dividends/review/enrichment?fromPaymentDate=2020-01-01&toPaymentDate=2026-12-31&sourceComposition=pending";
await apiSample(enrichmentPath);
for (let index = 0; index < samples; index += 1) raw.api.enrichmentFilter.push(await apiSample(enrichmentPath));

const browser = await chromium.launch({ headless: true });
try {
  for (let index = 0; index < samples; index += 1) {
    const opened = await openReview(browser);
    await opened.page.locator('[data-testid="dividend-review-charts"]').waitFor({ state: "visible", timeout: 10_000 });
    const enrichmentCompleteMs = opened.enrichmentResponses.length
      ? opened.enrichmentResponses.at(-1).elapsedAtMs - opened.started
      : null;
    raw.browser.coldLoad.push({ tableUsableMs: opened.tableUsableMs, enrichmentCompleteMs });
    await opened.context.close();
  }

  for (const field of sortFields) {
    raw.browser.sorts[field] = { asc: [], desc: [] };
    for (let index = 0; index < samples; index += 1) {
      const { context, page } = await openReview(browser);
      const button = page.getByTestId(field === "varianceAmount" ? "review-sort-variance" : `review-sort-${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`);
      raw.browser.sorts[field].asc.push(await measureInteraction(
        page,
        () => button.click(),
        (response) => response.url().includes("/portfolio/dividends/review/primary")
          && response.url().includes(`sortBy=${field}`) && response.url().includes("sortOrder=asc"),
      ));
      // paymentDate/desc at limit=10 is the SSR seed identity and therefore an
      // exact client-cache hit. Move to an uncached page-size identity so this
      // measured descending sample exercises PostgreSQL and a visible commit.
      if (field === "paymentDate") {
        await measureInteraction(page, () => page.getByTestId("review-page-size").selectOption("25"),
          (response) => response.url().includes("/portfolio/dividends/review/primary") && response.url().includes("limit=25"));
      }
      raw.browser.sorts[field].desc.push(await measureInteraction(
        page,
        () => button.click(),
        (response) => response.url().includes("/portfolio/dividends/review/primary")
          && response.url().includes(`sortBy=${field}`) && response.url().includes("sortOrder=desc"),
      ));
      await context.close();
    }
  }

  for (let index = 0; index < samples; index += 1) {
    const { context, page } = await openReview(browser);
    const pageOne = await visibleRowIds(page);
    const next = await measureInteraction(page, () => page.getByTestId("pagination-next").click(),
      (response) => response.url().includes("/portfolio/dividends/review/primary") && response.url().includes("page=2"));
    const previous = await measureCachedInteraction(page, () => page.getByTestId("pagination-prev").click(), pageOne);
    raw.browser.pagination.push({ pageOne, next, previous, restoredExactly: pageOne.join("|") === previous.afterIds.join("|") });
    await context.close();
  }

  for (const size of [10, 25, 50]) {
    raw.browser.pageSizes[size] = [];
    for (let index = 0; index < samples; index += 1) {
      const { context, page } = await openReview(browser);
      if (size === 10) {
        const initialTenIds = await visibleRowIds(page);
        await measureInteraction(page, () => page.getByTestId("review-page-size").selectOption("25"),
          (response) => response.url().includes("/portfolio/dividends/review/primary") && response.url().includes("limit=25"));
        const measured = await measureCachedInteraction(page, () => page.getByTestId("review-page-size").selectOption("10"), initialTenIds);
        raw.browser.pageSizes[size].push({ ...measured, rowCount: measured.afterIds.length });
      } else {
        const measured = await measureInteraction(page, () => page.getByTestId("review-page-size").selectOption(String(size)),
          (response) => response.url().includes("/portfolio/dividends/review/primary") && response.url().includes(`limit=${size}`));
        raw.browser.pageSizes[size].push({ ...measured, rowCount: measured.afterIds.length });
      }
      await context.close();
    }
  }

  for (let index = 0; index < samples; index += 1) {
    const { context, page } = await openReview(browser);
    const primary = measureInteraction(page, () => page.getByTestId("filter-status").selectOption("open"),
      (response) => response.url().includes("/portfolio/dividends/review/primary") && response.url().includes("reconciliationStatus=open"));
    const enrichment = page.waitForResponse((response) => response.url().includes("/portfolio/dividends/review/enrichment")
      && response.url().includes("reconciliationStatus=open"));
    const [primaryResult, enrichmentResponse] = await Promise.all([primary, enrichment]);
    raw.browser.filter.push({
      ...primaryResult,
      enrichmentServerTimingRaw: enrichmentResponse.headers()["server-timing"] ?? null,
      enrichmentServerTiming: parseServerTiming(enrichmentResponse.headers()["server-timing"]),
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const allApiPrimary = Object.entries(raw.api).filter(([key]) => key !== "enrichmentFilter").flatMap(([, value]) => value);
const allSorts = Object.values(raw.browser.sorts).flatMap((orders) => [...orders.asc, ...orders.desc]);
const paginationTransitions = raw.browser.pagination.flatMap((sample) => [sample.next, sample.previous]);
const pageSizeChanges = Object.values(raw.browser.pageSizes).flatMap((values) => values);
const allInteractions = [...allSorts, ...paginationTransitions, ...pageSizeChanges, ...raw.browser.filter];
const summary = {
  apiPrimaryScenarios: Object.fromEntries(Object.entries(raw.api)
    .filter(([key]) => key !== "enrichmentFilter")
    .map(([key, values]) => [key, summarize(values.map((sample) => sample.elapsedMs))])),
  apiPrimary: summarize(allApiPrimary.map((sample) => sample.elapsedMs)),
  apiEnrichment: summarize(raw.api.enrichmentFilter.map((sample) => sample.elapsedMs)),
  coldTableUsable: summarize(raw.browser.coldLoad.map((sample) => sample.tableUsableMs)),
  enrichmentComplete: summarize(raw.browser.coldLoad.map((sample) => sample.enrichmentCompleteMs)),
  sortScenarios: Object.fromEntries(Object.entries(raw.browser.sorts).flatMap(([field, orders]) => [
    [`${field}:asc`, summarize(orders.asc.map((sample) => sample.visibleMs))],
    [`${field}:desc`, summarize(orders.desc.map((sample) => sample.visibleMs))],
  ])),
  sorts: summarize(allSorts.map((sample) => sample.visibleMs)),
  pagination: summarize(paginationTransitions.map((sample) => sample.visibleMs)),
  pageSizeScenarios: Object.fromEntries(Object.entries(raw.browser.pageSizes)
    .map(([size, values]) => [size, summarize(values.map((sample) => sample.visibleMs))])),
  pageSizeChanges: summarize(pageSizeChanges.map((sample) => sample.visibleMs)),
  filterPrimary: summarize(raw.browser.filter.map((sample) => sample.visibleMs)),
  loadingFeedback: summarize(allInteractions.map((sample) => sample.feedbackMs)),
  wrongQueryFrames: allInteractions.reduce((sum, sample) => sum + sample.wrongQueryFrames, 0),
  paginationIdentityFailures: raw.browser.pagination.filter((sample) => !sample.restoredExactly).length,
};

await mkdir(outputDir, { recursive: true });
await writeFile(new URL("raw.json", outputDir), JSON.stringify(raw, null, 2) + "\n");
await writeFile(new URL("summary.json", outputDir), JSON.stringify(summary, null, 2) + "\n");
const row = (name, value, budget) => `| ${name} | ${value.count} | ${value.medianMs?.toFixed(1) ?? "n/a"} | ${value.p95Ms?.toFixed(1) ?? "n/a"} | ${value.maxMs?.toFixed(1) ?? "n/a"} | ${budget} |`;
const markdown = `# Dividends Review performance evidence\n\n` +
  `Generated: ${raw.metadata.generatedAt}\n\n` +
  `Method: ${raw.metadata.runtime}; ${samples} measured samples per scenario after an excluded warm-up; ` +
  `PostgreSQL fixture with 280 rows across 2020–2026. Browser timings use Chromium and user-visible committed row identities. ` +
  `Raw response headers, Server-Timing segments, row identities, and wrong-query-frame observations are in \`raw.json\`.\n\n` +
  `Commit: \`${raw.metadata.commit}\`  \nEnvironment: ${raw.metadata.operatingSystem}; ${raw.metadata.cpu}; ${raw.metadata.database}\n\n` +
  `Runner command: \`PERF_SAMPLES=${samples} PERF_WEB_URL=${webBaseUrl} PERF_API_URL=${apiBaseUrl} PERF_COMMIT=${raw.metadata.commit} node docs/notes/dividend-review-performance/run-performance-measurement.mjs\`. ` +
  `The fixture is created by \`seed-performance-postgres.ts\` after setting \`DB_URL\` to a disposable migrated database.\n\n` +
  `## Baseline comparison\n\n` +
  `The validated deployed-dev baseline was approximately 45 seconds to first rows, 58 seconds to full load, 3 seconds per current-year sort, and 9.5–10.6 seconds per all-years pagination transition. ` +
  `The post-change measurements below use an isolated local PostgreSQL 15 database with a deterministic realistic 280-row fixture and production-built web/API artifacts. ` +
  `They are repeatable acceptance evidence, not a claim that local hardware and the deployed dev environment are identical; a deployed follow-up remains useful for infrastructure-level comparison.\n\n` +
  `| Scenario | Samples | Median ms | P95 ms | Max ms | Budget |\n|---|---:|---:|---:|---:|---:|\n` +
  row("Primary API (all sorts)", summary.apiPrimary, "<800 ms P95") + "\n" +
  row("Enrichment API", summary.apiEnrichment, "<5000 ms P95") + "\n" +
  row("Cold usable table", summary.coldTableUsable, "<2500 ms P95") + "\n" +
  row("Cold enrichment complete", summary.enrichmentComplete, "<5000 ms P95") + "\n" +
  row("Sort interactions", summary.sorts, "<1500 ms P95") + "\n" +
  row("Pagination interactions", summary.pagination, "<1500 ms P95") + "\n" +
  row("Page-size interactions", summary.pageSizeChanges, "<1500 ms P95") + "\n" +
  row("Filter primary", summary.filterPrimary, "<1500 ms P95") + "\n" +
  row("Loading feedback", summary.loadingFeedback, "<100 ms P95") + "\n\n" +
  `Wrong-query frames: ${summary.wrongQueryFrames}. Pagination identity failures: ${summary.paginationIdentityFailures}.\n\n` +
  `## Sort scenarios\n\n| Sort | Samples | Median ms | P95 ms | Max ms |\n|---|---:|---:|---:|---:|\n` +
  Object.entries(summary.sortScenarios).map(([name, value]) =>
    `| ${name} | ${value.count} | ${value.medianMs?.toFixed(1)} | ${value.p95Ms?.toFixed(1)} | ${value.maxMs?.toFixed(1)} |`).join("\n") + "\n";
await writeFile(new URL("results.md", outputDir), markdown);
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
