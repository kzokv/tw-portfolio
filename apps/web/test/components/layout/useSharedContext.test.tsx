import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "../../../lib/i18n";

const navigation = vi.hoisted(() => ({ pathname: "/dividends", refresh: vi.fn() }));
const sharing = vi.hoisted(() => ({ fetchPage: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams("view=ledger"),
  useRouter: () => navigation,
}));

vi.mock("../../../hooks/useSharedContextOwnerId", () => ({
  useSharedContextOwnerId: () => null,
}));

vi.mock("../../../features/sharing/service", () => ({
  fetchSharingPageData: sharing.fetchPage,
}));

import { useSharedContext } from "../../../components/layout/useSharedContext";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function Harness({ refreshDashboard, refreshProfile }: {
  refreshDashboard: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}) {
  const context = useSharedContext({ refreshDashboard, refreshProfile, dict: getDictionary("en") });
  return (
    <div>
      <span data-testid="context-refresh-signal">{context.contextRefreshSignal}</span>
      <button type="button" onClick={() => context.handleContextSelect("owner-1")}>Select owner</button>
    </div>
  );
}

describe("useSharedContext", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    navigation.pathname = "/dividends";
    sharing.fetchPage.mockResolvedValue({ inbound: { active: [] } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("refreshes context-aware clients without starting a same-route navigation", async () => {
    const refreshDashboard = vi.fn().mockResolvedValue(undefined);
    const refreshProfile = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<Harness refreshDashboard={refreshDashboard} refreshProfile={refreshProfile} />));
    await act(async () => {});

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='context-refresh-signal']")?.textContent).toBe("1");
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("refreshes the server route outside Dividends as a context-change fallback", async () => {
    navigation.pathname = "/tickers/2330";
    const refreshDashboard = vi.fn().mockResolvedValue(undefined);
    const refreshProfile = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(<Harness refreshDashboard={refreshDashboard} refreshProfile={refreshProfile} />));
    await act(async () => {});

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='context-refresh-signal']")?.textContent).toBe("1");
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });
});
