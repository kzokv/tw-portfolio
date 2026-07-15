import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecomputePreviewDto } from "@vakwen/shared-types";
import { RecomputeConfirmDialog } from "../../../components/portfolio/RecomputeConfirmDialog";
import { getDictionary } from "../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const preview: RecomputePreviewDto = {
  id: "job-1",
  jobId: "job-1",
  status: "PREVIEWED",
  mode: "RECALCULATE_CALCULATED",
  fingerprint: "fingerprint-1",
  expiresAt: "2026-07-14T10:00:00.000Z",
  counts: { total: 8, calculated: 5, preserved: 3, changed: 2 },
  impactsByCurrency: [
    { currency: "TWD", commissionDelta: 12, taxDelta: -3 },
    { currency: "USD", commissionDelta: 0, taxDelta: 0 },
  ],
};

describe("RecomputeConfirmDialog", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("starts with recorded fees and requests an impact preview before confirmation", async () => {
    const onRequestPreview = vi.fn();
    await act(async () => {
      root.render(
        <RecomputeConfirmDialog
          open
          onOpenChange={vi.fn()}
          feeMode="KEEP_RECORDED"
          onFeeModeChange={vi.fn()}
          preview={null}
          onRequestPreview={onRequestPreview}
          onConfirm={vi.fn()}
          dict={getDictionary("en")}
          locale="en"
          isPreviewLoading={false}
          isConfirming={false}
          errorMessage=""
          statusMessage=""
        />,
      );
    });

    expect(document.querySelector("[data-testid='recompute-mode-keep']")?.getAttribute("data-state")).toBe("checked");
    expect(document.querySelector("[data-testid='recompute-impact-preview']")).toBeNull();
    const action = document.querySelector<HTMLButtonElement>("[data-testid='recompute-confirm-dialog-cta']");
    expect(action?.textContent).toContain("Review impact");
    act(() => action?.click());
    expect(onRequestPreview).toHaveBeenCalledTimes(1);
  });

  it("shows native-currency impact and requires the explicit apply action", async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <RecomputeConfirmDialog
          open
          onOpenChange={vi.fn()}
          feeMode="RECALCULATE_CALCULATED"
          onFeeModeChange={vi.fn()}
          preview={preview}
          onRequestPreview={vi.fn()}
          onConfirm={onConfirm}
          dict={getDictionary("en")}
          locale="en"
          isPreviewLoading={false}
          isConfirming={false}
          errorMessage=""
          statusMessage=""
        />,
      );
    });

    const impact = document.querySelector("[data-testid='recompute-impact-preview']");
    expect(impact?.textContent).toContain("TWD");
    expect(impact?.textContent).toContain("USD");
    expect(impact?.textContent).toContain("2");
    const action = document.querySelector<HTMLButtonElement>("[data-testid='recompute-confirm-dialog-cta']");
    expect(action?.textContent).toContain("Apply recompute");
    act(() => action?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
