import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockPatchJson = vi.fn();

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  patchJson: (...args: unknown[]) => mockPatchJson(...args),
}));

let mockParams = new URLSearchParams({ tab: "provider-health" });

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/admin/settings",
  useSearchParams: () => mockParams,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { AdminSettingsClient } from "../../../components/admin/AdminSettingsClient";
import { buildAppConfigDto } from "../../fixtures/appConfigDto";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("AdminSettingsClient — provider pacing settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockPatchJson.mockReset();
    mockParams = new URLSearchParams({ tab: "provider-health" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders provider pacing controls with Yahoo KR enforcement surfaced", () => {
    act(() => {
      root.render(<AdminSettingsClient initial={buildAppConfigDto()} />);
    });

    expect(document.body.textContent).toContain("Provider pacing");
    expect(document.body.textContent).toContain("Minimum spacing between provider requests. Null uses the default; 0 disables spacing.");
    expect(document.body.textContent).toContain("FinMind minimum request interval");
    expect(document.body.textContent).toContain("Yahoo KR minimum request interval");
    expect(document.body.textContent).toContain("Status: Enforced now.");
    expect(document.querySelector("[data-testid='admin-settings-yahooKrProviderMinRequestIntervalMs-row']")).not.toBeNull();
    expect(document.querySelector("[data-testid='admin-settings-yahooKrProviderMinRequestIntervalMs-toggle']")).not.toBeNull();
  });
});
