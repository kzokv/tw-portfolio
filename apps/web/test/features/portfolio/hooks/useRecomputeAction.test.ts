import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecomputeAction } from "../../../../features/portfolio/hooks/useRecomputeAction";
import type { RecomputePreviewDto } from "@vakwen/shared-types";
import { ApiError } from "../../../../lib/api";

vi.mock("../../../../features/portfolio/services/portfolioService", () => ({
  previewRecompute: vi.fn(),
  confirmRecompute: vi.fn(),
}));

import {
  confirmRecompute,
  previewRecompute,
} from "../../../../features/portfolio/services/portfolioService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const keepPreview: RecomputePreviewDto = {
  id: "job-keep",
  jobId: "job-keep",
  status: "PREVIEWED",
  mode: "KEEP_RECORDED",
  fingerprint: "fingerprint-keep",
  expiresAt: "2026-07-14T10:00:00.000Z",
  counts: { total: 4, calculated: 2, preserved: 4, changed: 0 },
  impactsByCurrency: [{ currency: "TWD", commissionDelta: 0, taxDelta: 0 }],
};

type HookResult = ReturnType<typeof useRecomputeAction>;
let result: HookResult;

function Harness({ refresh }: { refresh: () => Promise<void> }) {
  result = useRecomputeAction({
    locale: "en",
    refresh,
    previewRefreshedMessage: "Preview refreshed. Confirm again.",
  });
  return null;
}

describe("useRecomputeAction", () => {
  let container: HTMLDivElement;
  let root: Root;
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(previewRecompute).mockResolvedValue(keepPreview);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(previewRecompute).mockReset();
    vi.mocked(confirmRecompute).mockReset();
  });

  function mount() {
    act(() => root.render(createElement(Harness, { refresh })));
  }

  it("defaults to recorded fees and invalidates a reviewed preview when mode changes", async () => {
    mount();

    expect(result.feeMode).toBe("KEEP_RECORDED");
    await act(async () => {
      await result.requestPreview();
    });
    expect(previewRecompute).toHaveBeenCalledWith("KEEP_RECORDED");
    expect(result.preview).toEqual(keepPreview);

    act(() => result.setFeeMode("RECALCULATE_CALCULATED"));
    expect(result.feeMode).toBe("RECALCULATE_CALCULATED");
    expect(result.preview).toBeNull();
  });

  it("silently refreshes stale impact without automatically confirming it", async () => {
    const refreshedPreview: RecomputePreviewDto = {
      ...keepPreview,
      id: "job-refreshed",
      jobId: "job-refreshed",
      fingerprint: "fingerprint-refreshed",
    };
    vi.mocked(confirmRecompute).mockRejectedValueOnce(
      new ApiError("Preview expired", 409, "recompute_preview_expired"),
    );
    mount();

    await act(async () => {
      await result.requestPreview();
    });
    vi.mocked(previewRecompute).mockResolvedValueOnce(refreshedPreview);

    let confirmed = true;
    await act(async () => {
      confirmed = await result.confirmPreview();
    });

    expect(confirmed).toBe(false);
    expect(confirmRecompute).toHaveBeenCalledTimes(1);
    expect(previewRecompute).toHaveBeenCalledTimes(2);
    expect(result.preview).toEqual(refreshedPreview);
    expect(result.message).toBe("Preview refreshed. Confirm again.");
    expect(result.errorMessage).toBe("");
    expect(result.isConfirming).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("invalidates the reviewed fingerprint when automatic stale refresh fails", async () => {
    vi.mocked(confirmRecompute).mockRejectedValueOnce(
      new ApiError("Preview expired", 409, "recompute_preview_expired"),
    );
    mount();

    await act(async () => {
      await result.requestPreview();
    });
    vi.mocked(previewRecompute).mockRejectedValueOnce(new Error("fresh preview unavailable"));

    await act(async () => {
      await result.confirmPreview();
    });

    expect(result.preview).toBeNull();
    expect(result.errorMessage).toBe("fresh preview unavailable");
    expect(result.message).toBe("");

    await act(async () => {
      await result.confirmPreview();
    });
    expect(confirmRecompute).toHaveBeenCalledTimes(1);
  });

  it("reports confirmation success and consumes the preview when the follow-up refresh fails", async () => {
    vi.mocked(confirmRecompute).mockResolvedValueOnce({
      jobId: keepPreview.jobId,
      status: "CONFIRMED",
      mode: "KEEP_RECORDED",
      counts: keepPreview.counts,
    });
    refresh.mockRejectedValueOnce(new Error("portfolio refresh unavailable"));
    mount();

    await act(async () => {
      await result.requestPreview();
    });

    let confirmed = false;
    await act(async () => {
      confirmed = await result.confirmPreview();
    });

    expect(confirmed).toBe(true);
    expect(confirmRecompute).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.preview).toBeNull();
    expect(result.message).toBe("Recompute CONFIRMED, items: 4");
    expect(result.errorMessage).toBe("portfolio refresh unavailable");
    expect(result.isConfirming).toBe(false);
  });
});
