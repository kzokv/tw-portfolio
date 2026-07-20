import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { join } from "node:path";
import type { ProfilerOnRenderCallback } from "react";

export interface PerformanceSample {
  action: string;
  actualDurationMs: number;
  iteration: number;
  kind: "measured" | "warmup";
}

export interface PerformanceScenario {
  fixture: Record<string, unknown>;
  metric: "react-profiler-actualDuration" | "wall-clock-sort-duration";
  name: string;
  samples: PerformanceSample[];
}

const FRONTEND_PRODUCTION_ROOTS = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/features",
  "apps/web/hooks",
  "apps/web/lib",
] as const;

interface PerformanceCapture {
  baseSha: string;
  capturePhase: "baseline" | "post";
  capturedAt: string;
  environment: Record<string, unknown>;
  frontendDiffState: Record<string, unknown>;
  historicalReference: {
    label: string;
    p95Ms: number;
    treatment: string;
  };
  scenarios: Record<string, PerformanceScenario>;
}

interface PendingAction {
  action: string;
  iteration: number;
  kind: PerformanceSample["kind"];
}

export function createCommitProfilerRecorder({
  measuredCount,
  name,
  warmupCount,
}: {
  measuredCount: number;
  name: string;
  warmupCount: number;
}) {
  const samples: PerformanceSample[] = [];
  let pending: PendingAction | null = null;
  let actionCount = 0;

  const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
    if (phase !== "update" || pending === null) return;
    samples.push({ ...pending, actualDurationMs: actualDuration });
    pending = null;
  };

  return {
    arm(action: string) {
      if (pending !== null) {
        throw new Error(`${name}: profiler action ${pending.action} did not commit`);
      }
      const kind = actionCount < warmupCount ? "warmup" : "measured";
      pending = { action, iteration: actionCount, kind };
      actionCount += 1;
    },
    assertCommitted() {
      if (pending !== null) {
        throw new Error(`${name}: profiler action ${pending.action} did not produce an update commit`);
      }
    },
    onRender,
    scenario(fixture: Record<string, unknown>): PerformanceScenario {
      const measured = samples.filter((sample) => sample.kind === "measured");
      const warmup = samples.filter((sample) => sample.kind === "warmup");
      if (warmup.length !== warmupCount || measured.length !== measuredCount) {
        throw new Error(
          `${name}: expected ${warmupCount} warmup and ${measuredCount} measured commits, `
          + `received ${warmup.length} and ${measured.length}`,
        );
      }
      return {
        fixture,
        metric: "react-profiler-actualDuration",
        name,
        samples,
      };
    },
  };
}

export function summarizeDurations(samples: PerformanceSample[]) {
  const measured = samples
    .filter((sample) => sample.kind === "measured")
    .map((sample) => sample.actualDurationMs)
    .sort((left, right) => left - right);
  if (measured.length === 0) {
    return { count: 0, maxMs: null, meanMs: null, minMs: null, p50Ms: null, p95Ms: null };
  }
  const percentile = (value: number) => measured[Math.min(measured.length - 1, Math.ceil(value * measured.length) - 1)]!;
  return {
    count: measured.length,
    maxMs: measured[measured.length - 1]!,
    meanMs: measured.reduce((sum, value) => sum + value, 0) / measured.length,
    minMs: measured[0]!,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}

export function recordPerformanceScenario(scenario: PerformanceScenario): void {
  const capturePhase = parseCapturePhase(process.env.HOLDINGS_PERF_PHASE);
  const repoRoot = git(["rev-parse", "--show-toplevel"]);
  const outputDirectory = join(repoRoot, ".worklog", "team", "performance");
  const rawPath = join(outputDirectory, `holdings-sorting-${capturePhase}.raw.json`);
  const summaryPath = join(outputDirectory, `holdings-sorting-${capturePhase}.summary.json`);
  const diff = git(["diff", "--", "apps/web"], repoRoot);
  const status = git(["status", "--short", "--", "apps/web"], repoRoot);
  const frontendSourceState = captureFrontendSourceState(repoRoot);
  const existing = readJson<PerformanceCapture>(rawPath);
  const capture: PerformanceCapture = {
    baseSha: git(["rev-parse", "HEAD"]),
    capturePhase,
    capturedAt: new Date().toISOString(),
    environment: {
      architecture: arch(),
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      nodeEnv: process.env.NODE_ENV ?? null,
      nodeVersion: process.version,
      operatingSystem: platform(),
      operatingSystemRelease: release(),
      v8Version: process.versions.v8,
      vitestMode: process.env.VITEST ? "vitest" : "unknown",
    },
    frontendDiffState: {
      diffSha256: createHash("sha256").update(diff).digest("hex"),
      ...frontendSourceState,
      status: status === "" ? [] : status.split("\n"),
    },
    historicalReference: {
      label: "scope-session pure-sort proxy (historical; not this capture)",
      p95Ms: 3.42,
      treatment: "context only; never merged into current samples or thresholds",
    },
    scenarios: {
      ...(existing?.scenarios ?? {}),
      [scenario.name]: scenario,
    },
  };
  const summaries = Object.fromEntries(
    Object.entries(capture.scenarios).map(([name, value]) => [name, {
      fixture: value.fixture,
      metric: value.metric,
      summary: summarizeDurations(value.samples),
      warmupCount: value.samples.filter((sample) => sample.kind === "warmup").length,
    }]),
  );
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(rawPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify({
    baseSha: capture.baseSha,
    capturePhase: capture.capturePhase,
    capturedAt: capture.capturedAt,
    environment: capture.environment,
    frontendDiffState: capture.frontendDiffState,
    historicalReference: capture.historicalReference,
    scenarios: summaries,
  }, null, 2)}\n`, "utf8");
}

export function captureFrontendSourceState(repoRoot = git(["rev-parse", "--show-toplevel"])) {
  const trackedPaths = lines(git(["ls-files", "--", ...FRONTEND_PRODUCTION_ROOTS], repoRoot));
  const untrackedPaths = lines(git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...FRONTEND_PRODUCTION_ROOTS,
  ], repoRoot));
  const sourcePaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  const sourceHash = createHash("sha256");
  for (const sourcePath of sourcePaths) {
    sourceHash.update(sourcePath);
    sourceHash.update("\0");
    sourceHash.update(readFileSync(join(repoRoot, sourcePath)));
    sourceHash.update("\0");
  }
  const productionStatus = git(["status", "--short", "--", ...FRONTEND_PRODUCTION_ROOTS], repoRoot);
  return {
    productionSourcePathCount: sourcePaths.length,
    productionSourceSha256: sourceHash.digest("hex"),
    productionStatus: lines(productionStatus),
    untrackedProductionPaths: untrackedPaths.sort(),
  };
}

function parseCapturePhase(value: string | undefined): "baseline" | "post" {
  if (value === "baseline" || value === "post") return value;
  throw new Error("HOLDINGS_PERF_PHASE must be explicitly set to baseline or post");
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function lines(value: string): string[] {
  return value === "" ? [] : value.split("\n").filter(Boolean);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}
