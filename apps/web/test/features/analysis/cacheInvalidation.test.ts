import { describe, expect, it } from "vitest";
import { SNAPSHOT_ROUTE_CACHE_TAGS } from "../../../components/layout/useSnapshotGeneration";
import { MUTATION_ROUTE_CACHE_TAGS } from "../../../features/portfolio/hooks/useTransactionMutations";
import { buildRouteDtoCacheTag } from "../../../lib/routeDtoCache";

describe("analysis cache invalidation", () => {
  it("clears unrealized P&L analysis cache after transaction mutations and snapshot generation", () => {
    const analysisTag = buildRouteDtoCacheTag("route", "analysis-unrealized-pnl");

    expect(MUTATION_ROUTE_CACHE_TAGS).toContain(analysisTag);
    expect(SNAPSHOT_ROUTE_CACHE_TAGS).toContain(analysisTag);
  });
});
