// KZO-198 Fix 2 — `buildMarketDataRegistry` consults the appConfig resolver
// before falling back to env when deciding real-vs-mock provider. Fresh
// deploys with the API token set in `app_config.finmindApiToken` (instead
// of env) must select the REAL provider on the first run, not degrade to
// the mock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/appConfig/providerKeys.js", () => ({
  getEffectiveFinmindApiToken: vi.fn(),
  getEffectiveTwelveDataApiKey: vi.fn(),
}));

const cacheMock = await import("../../../src/services/appConfig/providerKeys.js");
const { buildMarketDataRegistry } = await import("../../../src/services/market-data/registry.js");
const {
  FinMindMarketDataProvider,
  MockFinMindMarketDataProvider,
  TwelveDataAuCatalogProvider,
  MockTwelveDataAuCatalogProvider,
  TwelveDataKrCatalogProvider,
  MockTwelveDataKrCatalogProvider,
} = await import("../../../src/services/market-data/providers/index.js");

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    FINMIND_API_TOKEN: undefined,
    FINMIND_BASE_URL: "https://api.finmindtrade.com/api/v4/data",
    FINMIND_RATE_LIMIT_PER_HOUR: 600,
    TWELVE_DATA_API_KEY: undefined,
    TWELVE_DATA_BASE_URL: "https://api.twelvedata.com",
    TWELVE_DATA_RATE_LIMIT_PER_MINUTE: 8,
    AU_PROVIDER_MOCK: false,
    AU_CATALOG_PROVIDER_MOCK: false,
    YAHOO_AU_RATE_LIMIT_PER_MINUTE: 60,
    KR_PROVIDER_MOCK: false,
    KR_CATALOG_PROVIDER_MOCK: false,
    YAHOO_KR_RATE_LIMIT_PER_MINUTE: 60,
    FX_PROVIDER_MOCK: true,
    FRANKFURTER_BASE_URL: "https://api.frankfurter.dev/v2",
    ...overrides,
  };
}

describe("buildMarketDataRegistry — KZO-198 provider-key gate consults resolver", () => {
  beforeEach(() => {
    vi.mocked(cacheMock.getEffectiveFinmindApiToken).mockReset();
    vi.mocked(cacheMock.getEffectiveTwelveDataApiKey).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses MOCK FinMind provider when both resolver and env are empty", () => {
    vi.mocked(cacheMock.getEffectiveFinmindApiToken).mockReturnValue(undefined);
    vi.mocked(cacheMock.getEffectiveTwelveDataApiKey).mockReturnValue(undefined);
    const registry = buildMarketDataRegistry(makeEnv() as never);
    expect(registry.marketData.get("TW")).toBeInstanceOf(MockFinMindMarketDataProvider);
  });

  it("uses REAL FinMind provider when env has token (legacy path)", () => {
    vi.mocked(cacheMock.getEffectiveFinmindApiToken).mockReturnValue("env-token");
    vi.mocked(cacheMock.getEffectiveTwelveDataApiKey).mockReturnValue(undefined);
    const registry = buildMarketDataRegistry(makeEnv({ FINMIND_API_TOKEN: "env-token" }) as never);
    expect(registry.marketData.get("TW")).toBeInstanceOf(FinMindMarketDataProvider);
  });

  it("uses REAL FinMind provider when env is EMPTY but resolver returns token (KZO-198 fix)", () => {
    // The bug: prior code gated only on `env.FINMIND_API_TOKEN`. With env
    // unset and DB-set token, the registry would silently pick the mock.
    vi.mocked(cacheMock.getEffectiveFinmindApiToken).mockReturnValue("db-token");
    vi.mocked(cacheMock.getEffectiveTwelveDataApiKey).mockReturnValue(undefined);
    const registry = buildMarketDataRegistry(makeEnv() as never);
    expect(registry.marketData.get("TW")).toBeInstanceOf(FinMindMarketDataProvider);
  });

  it("uses REAL Twelve Data AU catalog when env is EMPTY but resolver returns key (KZO-198 fix)", () => {
    vi.mocked(cacheMock.getEffectiveFinmindApiToken).mockReturnValue(undefined);
    vi.mocked(cacheMock.getEffectiveTwelveDataApiKey).mockReturnValue("td-db-key");
    const registry = buildMarketDataRegistry(makeEnv() as never);
    expect(registry.catalog.get("AU")).toBeInstanceOf(TwelveDataAuCatalogProvider);
    expect(registry.catalog.get("KR")).toBeInstanceOf(TwelveDataKrCatalogProvider);
  });

  it("uses MOCK Twelve Data AU catalog when both env and resolver are empty", () => {
    vi.mocked(cacheMock.getEffectiveFinmindApiToken).mockReturnValue(undefined);
    vi.mocked(cacheMock.getEffectiveTwelveDataApiKey).mockReturnValue(undefined);
    const registry = buildMarketDataRegistry(makeEnv() as never);
    expect(registry.catalog.get("AU")).toBeInstanceOf(MockTwelveDataAuCatalogProvider);
    expect(registry.catalog.get("KR")).toBeInstanceOf(MockTwelveDataKrCatalogProvider);
  });
});
