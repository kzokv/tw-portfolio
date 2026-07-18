import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div />,
}));

vi.mock("../../../components/transactions/PostedTransactionMutationPreviewClient", () => ({
  PostedTransactionMutationPreviewClient: () => <div />,
}));

vi.mock("../../../components/transactions/PostedTransactionMutationRunClient", () => ({
  PostedTransactionMutationRunClient: () => <div />,
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import PostedTransactionMutationPreviewPage from "../../../app/transactions/mutations/previews/[previewId]/page";
import PostedTransactionMutationRunPage from "../../../app/transactions/mutations/runs/[runId]/page";

const requireSessionMock = vi.mocked(requireSession);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);

describe("posted transaction mutation pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ isDemo: false } as never);
    readSidebarStateCookieMock.mockResolvedValue(false as never);
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      return {};
    }) as never);
  });

  it("uses the deep-linked owner context for the initial preview fetch", async () => {
    await PostedTransactionMutationPreviewPage({
      params: Promise.resolve({ previewId: "preview-1" }),
      searchParams: Promise.resolve({ as: "owner-1" }),
    });

    expect(getJsonMock).toHaveBeenCalledWith(
      "/portfolio/transactions/mutations/previews/preview-1",
      {
        contextScope: "session",
        headers: { "x-context-user-id": "owner-1" },
      },
    );
  });

  it("uses the deep-linked owner context for the initial run fetch", async () => {
    await PostedTransactionMutationRunPage({
      params: Promise.resolve({ runId: "run-1" }),
      searchParams: Promise.resolve({ as: "owner-1" }),
    });

    expect(getJsonMock).toHaveBeenCalledWith(
      "/portfolio/transactions/mutations/runs/run-1",
      {
        contextScope: "session",
        headers: { "x-context-user-id": "owner-1" },
      },
    );
  });

  it("ignores malformed owner context values", async () => {
    await PostedTransactionMutationPreviewPage({
      params: Promise.resolve({ previewId: "preview-1" }),
      searchParams: Promise.resolve({ as: "owner/invalid" }),
    });

    expect(getJsonMock).toHaveBeenCalledWith(
      "/portfolio/transactions/mutations/previews/preview-1",
      undefined,
    );
  });
});
