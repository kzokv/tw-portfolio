import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaders = new Map<string, string>();
const mockGetSession = vi.fn();
const mockGetJson = vi.fn();
const mockFetch = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => mockHeaders.get(name) ?? null,
  })),
}));
vi.mock("../../../components/layout/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle-mock">theme toggle</div>,
}));

vi.mock("../../../lib/auth", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("../../../lib/api", () => ({
  API_BASE: "http://api.test",
  API_PUBLIC: "http://api.test",
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message);
    }
  },
  getJson: (...args: unknown[]) => mockGetJson(...args),
}));

import InvitePage from "../../../app/invite/[code]/page";

describe("InvitePage", () => {
  beforeEach(() => {
    mockHeaders.clear();
    mockGetSession.mockReset();
    mockGetJson.mockReset();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("renders sign-in CTA for a valid invite", async () => {
    mockGetSession.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "valid" }),
    });

    const element = await InvitePage({ params: Promise.resolve({ code: "invite42" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Accept your invite");
    expect(html).toContain('data-testid="google-sign-in-button"');
    expect(html).toContain("invite_code=INVITE42");
    expect(html).toContain("Invitation code");
    expect(html).toContain("INVITE42");
  });

  it("renders unavailable state without sign-in button for invalid invite", async () => {
    mockGetSession.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "invalid" }),
    });

    const element = await InvitePage({ params: Promise.resolve({ code: "bad-code" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Invite not found");
    expect(html).not.toContain('data-testid="google-sign-in-button"');
  });

  it("renders signed-in mismatch state with profile email", async () => {
    mockGetSession.mockResolvedValue({ userId: "user-1", isDemo: false, sessionVersion: 3 });
    mockGetJson.mockResolvedValue({ email: "member@example.com" });

    const element = await InvitePage({ params: Promise.resolve({ code: "invite42" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("You’re already signed in");
    expect(html).toContain("member@example.com");
    expect(html).toContain('data-testid="invite-sign-out-button"');
    expect(html).toContain('data-testid="invite-dashboard-button"');
    expect(html).toContain("Invitation code");
  });

  it("renders localized invite copy from Accept-Language", async () => {
    mockHeaders.set("accept-language", "zh-TW,zh;q=0.9");
    mockGetSession.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "revoked" }),
    });

    const element = await InvitePage({ params: Promise.resolve({ code: "invite42" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("邀請已撤銷");
    expect(html).not.toContain('data-testid="google-sign-in-button"');
  });
});
