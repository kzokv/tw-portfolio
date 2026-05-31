import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const apiDir = process.cwd();
const specsDir = path.join(apiDir, "test/http/specs");
const cliFilters = new Set(process.argv.slice(2));

function discoverPairs() {
  const entries = fs.readdirSync(specsDir).filter((file) => file.endsWith("-aaa.http.spec.ts"));
  const pairs = entries
    .map((aaaFile) => {
      const legacyFile = aaaFile.replace("-aaa.http.spec.ts", ".http.spec.ts");
      return {
        name: aaaFile.replace("-aaa.http.spec.ts", ""),
        legacy: legacyFile,
        aaa: aaaFile,
      };
    })
    .filter((pair) => fs.existsSync(path.join(specsDir, pair.legacy)));

  if (cliFilters.size === 0) {
    return pairs;
  }

  return pairs.filter((pair) => cliFilters.has(pair.name) || cliFilters.has(pair.aaa) || cliFilters.has(pair.legacy));
}

function runSpec(specFile) {
  const result = spawnSync(
    "npx",
    ["playwright", "test", `test/http/specs/${specFile}`, "--config", "test/http/playwright.config.ts", "--reporter=json"],
    {
      cwd: apiDir,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        `Playwright failed for ${specFile}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return JSON.parse(result.stdout);
}

function collectResults(suites, titlePath = []) {
  const results = [];

  for (const suite of suites ?? []) {
    const nextTitlePath = suite.title ? [...titlePath, suite.title] : titlePath;

    for (const spec of suite.specs ?? []) {
      const fullTitle = [...nextTitlePath, spec.title].filter(Boolean).join(" > ");
      const testRun = spec.tests?.[0];
      const finalResult = testRun?.results?.at(-1);

      results.push({
        title: fullTitle,
        expectedStatus: testRun?.expectedStatus ?? "passed",
        status: finalResult?.status ?? "unknown",
      });
    }

    results.push(...collectResults(suite.suites, nextTitlePath));
  }

  return results;
}

function normalizeResults(jsonReport) {
  return collectResults(jsonReport.suites)
    .map((result) => ({
      ...result,
      title: result.title.split(" > ").slice(1).join(" > "),
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function comparePair(pair) {
  const legacyResults = normalizeResults(runSpec(pair.legacy));
  const aaaResults = normalizeResults(runSpec(pair.aaa));

  if (legacyResults.length !== aaaResults.length) {
    throw new Error(
      `Pair ${pair.name} has different test counts: legacy=${legacyResults.length}, aaa=${aaaResults.length}`,
    );
  }

  for (let index = 0; index < legacyResults.length; index += 1) {
    const legacy = legacyResults[index];
    const aaa = aaaResults[index];

    if (legacy.title !== aaa.title) {
      throw new Error(
        `Pair ${pair.name} title mismatch at index ${index}: legacy="${legacy.title}", aaa="${aaa.title}"`,
      );
    }
    if (legacy.expectedStatus !== aaa.expectedStatus) {
      throw new Error(
        `Pair ${pair.name} expected status mismatch for "${legacy.title}": legacy=${legacy.expectedStatus}, aaa=${aaa.expectedStatus}`,
      );
    }
    if (legacy.status !== aaa.status) {
      throw new Error(
        `Pair ${pair.name} runtime status mismatch for "${legacy.title}": legacy=${legacy.status}, aaa=${aaa.status}`,
      );
    }
  }

  console.log(`validated ${pair.name}: ${legacyResults.length} tests matched`);
}

const pairs = discoverPairs();

if (pairs.length === 0) {
  console.log("No legacy/AAA HTTP pairs found.");
  process.exit(0);
}

for (const pair of pairs) {
  comparePair(pair);
}
