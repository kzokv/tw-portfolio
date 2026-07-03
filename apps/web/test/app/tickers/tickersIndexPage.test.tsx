import { describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: navigationMocks.redirect,
}));

import TickersIndexPage from "../../../app/tickers/page";

describe("TickersIndexPage", () => {
  it("redirects the tickers index to the portfolio page", () => {
    expect(() => TickersIndexPage()).toThrow("redirect:/portfolio");
    expect(navigationMocks.redirect).toHaveBeenCalledWith("/portfolio");
  });
});
