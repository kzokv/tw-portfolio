import { describe, it, expect } from "vitest";
import { ROUTES, E2E_ENDPOINTS, TIMEOUTS, TEST_DATA } from "../src/constants/index.js";

describe("E2E constants", () => {
  describe("ROUTES", () => {
    it("exports app routes", () => {
      expect(ROUTES.DASHBOARD).toBe("/dashboard");
      expect(ROUTES.PORTFOLIO).toBe("/portfolio");
      expect(ROUTES.TRANSACTIONS).toBe("/transactions");
      expect(ROUTES.LOGIN).toBe("/login");
      expect(ROUTES.AUTH_ERROR).toBe("/auth/error");
    });

    it("exports settings drawer route", () => {
      expect(ROUTES.SETTINGS_DRAWER).toBe("/dashboard?drawer=settings");
    });
  });

  describe("E2E_ENDPOINTS", () => {
    it("exports e2e API endpoints", () => {
      expect(E2E_ENDPOINTS.RESET).toBe("/__e2e/reset");
      expect(E2E_ENDPOINTS.OAUTH_SESSION).toBe("/__e2e/oauth-session");
      expect(E2E_ENDPOINTS.DEMO_SESSION).toBe("/__e2e/demo-session");
      expect(E2E_ENDPOINTS.RESET_DEMO_RATE_BUCKETS).toBe("/__e2e/reset-demo-rate-buckets");
    });
  });

  describe("TIMEOUTS", () => {
    it("exports standard timeout values", () => {
      expect(TIMEOUTS.APP_READY).toBe(30_000);
      expect(TIMEOUTS.SSE_HEARTBEAT).toBe(15_000);
      expect(TIMEOUTS.DEFAULT).toBe(10_000);
    });
  });

  describe("TEST_DATA", () => {
    it("exports test data constants", () => {
      expect(TEST_DATA.TICKER_SYMBOL).toBe("2330");
    });
  });
});
