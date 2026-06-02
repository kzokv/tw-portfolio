import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import {
  fetchDashboardEnrichmentData,
  fetchDashboardPrimaryData,
  fetchDashboardSnapshot,
} from "../../../features/dashboard/services/dashboardService";
import { getJson } from "../../../lib/api";

describe("dashboard primary/enrichment service paths", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({});
  });

  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("fetches first-paint primary data from the explicit primary endpoint", async () => {
    await fetchDashboardPrimaryData();
    expect(getJson).toHaveBeenCalledWith("/dashboard/primary");
  });

  it("fetches secondary enrichment from the explicit enrichment endpoint", async () => {
    await fetchDashboardEnrichmentData();
    expect(getJson).toHaveBeenCalledWith("/dashboard/enrichment");
  });

  it("keeps dashboard snapshot compatibility on the enrichment endpoint", async () => {
    await fetchDashboardSnapshot();
    expect(getJson).toHaveBeenCalledWith("/dashboard/enrichment");
  });
});
