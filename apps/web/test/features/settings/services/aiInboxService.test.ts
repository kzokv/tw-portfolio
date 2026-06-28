import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { fetchAiConnectorLogs } from "../../../../features/ai-inbox/service";
import { getJson } from "../../../../lib/api";

describe("fetchAiConnectorLogs", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({
      accessLogs: [],
      hasMore: false,
      nextOffset: null,
    });
  });

  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("appends connectionId when requesting connector-scoped activity", async () => {
    await fetchAiConnectorLogs({
      limit: 5,
      offset: 10,
      result: "ok",
      search: " portfolio ",
      connectionId: "conn-1",
    });

    expect(getJson).toHaveBeenCalledWith(
      "/ai/connectors/logs?limit=5&offset=10&result=ok&search=portfolio&connectionId=conn-1",
    );
  });

  it("omits connectionId when loading the unscoped activity feed", async () => {
    await fetchAiConnectorLogs({ limit: 3 });

    expect(getJson).toHaveBeenCalledWith("/ai/connectors/logs?limit=3");
  });
});
