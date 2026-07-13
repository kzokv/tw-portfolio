import { Buffer } from "node:buffer";
import type { FastifyReply, FastifyRequest } from "fastify";

// A phase may overlap db/app segments and is therefore diagnostic-only in the
// corresponding summary totals.
type TimingKind = "db" | "app" | "phase";

interface TimingSegment {
  name: string;
  kind: TimingKind;
  durationMs: number;
}

export class ReadPathTiming {
  private readonly startedAt = performance.now();

  private readonly segments: TimingSegment[] = [];

  async measure<T>(name: string, kind: TimingKind, fn: () => Promise<T> | T): Promise<T> {
    const startedAt = performance.now();
    try {
      return await fn();
    } finally {
      this.segments.push({
        name,
        kind,
        durationMs: performance.now() - startedAt,
      });
    }
  }

  record(name: string, kind: TimingKind, durationMs: number): void {
    this.segments.push({ name, kind, durationMs: Math.max(0, durationMs) });
  }

  attach(req: FastifyRequest, reply: FastifyReply, route: string, payload: unknown): void {
    const totalMs = performance.now() - this.startedAt;
    const dbMs = this.sum("db");
    const appMs = this.sum("app");
    const responseBytes = estimateResponseBytes(payload);
    const serverTiming = [
      formatMetric("total", totalMs),
      formatMetric("db", dbMs),
      formatMetric("app", appMs),
      ...this.segments.map((segment) => formatMetric(segment.name, segment.durationMs)),
    ].join(", ");

    reply.header("Server-Timing", serverTiming);
    req.log.info({
      msg: "read_path_timing",
      route,
      totalMs: roundMs(totalMs),
      dbMs: roundMs(dbMs),
      appMs: roundMs(appMs),
      responseBytes,
      segments: this.segments.map((segment) => ({
        ...segment,
        durationMs: roundMs(segment.durationMs),
      })),
    });
  }

  private sum(kind: TimingKind): number {
    return this.segments.reduce((sum, segment) => sum + (segment.kind === kind ? segment.durationMs : 0), 0);
  }
}

function formatMetric(name: string, durationMs: number): string {
  return `${name};dur=${roundMs(durationMs)}`;
}

function roundMs(value: number): number {
  return Number(value.toFixed(2));
}

function estimateResponseBytes(payload: unknown): number | null {
  if (payload === undefined) return null;
  if (typeof payload === "string") return Buffer.byteLength(payload);
  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return null;
  }
}
