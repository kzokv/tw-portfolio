// KZO-198 — Unit tests for providerKeys resolver category (Tier 0 secrets).
//
// Resolvers `decryptSecret(stored)` from cache; on `AppConfigDecryptError`
// they log `app_config_decrypt_failed` (current shape: console.warn) and
// env-fallback. Decryption errors are typed and caught only for the typed
// case (`typed-transient-error-catch-audit.md`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_APP_CONFIG_ENCRYPTION_KEY,
  TEST_APP_CONFIG_ENCRYPTION_KEY_ALT,
} from "../../fixtures/appConfigEncryptionKey.js";

// Per-test mutable Env shape (Env is normally frozen + parsed once at boot).
const mockEnv: {
  APP_CONFIG_ENCRYPTION_KEY?: string;
  FINMIND_API_TOKEN?: string;
  TWELVE_DATA_API_KEY?: string;
  EODHD_API_KEY?: string;
} = {
  APP_CONFIG_ENCRYPTION_KEY: TEST_APP_CONFIG_ENCRYPTION_KEY,
};
vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: new Proxy(
      { ...original.Env },
      {
        get(target, prop) {
          if (prop in mockEnv) {
            return (mockEnv as Record<string, unknown>)[prop as string];
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      },
    ),
  };
});

// Imports below resolve through the mock above.
const { Env } = await import("@vakwen/config");
const {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} = await import("../../../src/services/appConfig/cache.js");
const { encryptSecret } = await import("../../../src/services/appConfig/encryption.js");
const {
  getEffectiveFinmindApiToken,
  getEffectiveEodhdApiKey,
  getEffectiveTwelveDataApiKey,
} = await import("../../../src/services/appConfig/providerKeys.js");
const { fakePersistenceWithAppConfig, seedCache } = await import("./_helpers.js");

beforeEach(() => {
  _resetAppConfigCache();
  mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_APP_CONFIG_ENCRYPTION_KEY;
  delete mockEnv.FINMIND_API_TOKEN;
  delete mockEnv.TWELVE_DATA_API_KEY;
  delete mockEnv.EODHD_API_KEY;
});

afterEach(() => {
  _resetAppConfigCache();
  vi.restoreAllMocks();
});

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

const CASES = {
  getEffectiveFinmindApiToken: {
    resolver: getEffectiveFinmindApiToken,
    cacheField: "finmindApiTokenEncrypted",
    envField: "FINMIND_API_TOKEN" as const,
    dbValue: "finmind-token-from-app-config-x",
  },
  getEffectiveTwelveDataApiKey: {
    resolver: getEffectiveTwelveDataApiKey,
    cacheField: "twelveDataApiKeyEncrypted",
    envField: "TWELVE_DATA_API_KEY" as const,
    dbValue: "twelve-data-key-from-app-config",
  },
  getEffectiveEodhdApiKey: {
    resolver: getEffectiveEodhdApiKey,
    cacheField: "eodhdApiKeyEncrypted",
    envField: "EODHD_API_KEY" as const,
    dbValue: "eodhd-key-from-app-config",
  },
} as const;

for (const [name, tc] of Object.entries(CASES)) {
  describe(`appConfig/providerKeys — ${name}`, () => {
    it("returns Env fallback when cache entry is null", () => {
      expect(tc.resolver()).toBe(Env[tc.envField] ?? undefined);
    });

    it("returns Env fallback when encrypted column is NULL", async () => {
      setAppConfigCachePersistence(fakePersistenceWithAppConfig({}) as never);
      await refresh();
      expect(tc.resolver()).toBe(Env[tc.envField] ?? undefined);
    });

    it("returns the decrypted plaintext when encrypted column has a valid value", async () => {
      const ciphertext = encryptSecret(tc.dbValue);
      await seedCache({ [tc.cacheField]: ciphertext } as never, cacheModule);
      expect(tc.resolver()).toBe(tc.dbValue);
    });

    it("decrypted value takes precedence over env when env is set", async () => {
      (mockEnv as Record<string, string>)[tc.envField] = "env-value-should-not-win";
      const ciphertext = encryptSecret(tc.dbValue);
      await seedCache({ [tc.cacheField]: ciphertext } as never, cacheModule);
      const result = tc.resolver();
      expect(result).toBe(tc.dbValue);
      expect(result).not.toBe("env-value-should-not-win");
    });

    it("falls back to Env when stored ciphertext is malformed (no ':')", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await seedCache({ [tc.cacheField]: "not-a-valid-stored-shape" } as never, cacheModule);
      expect(tc.resolver()).toBe(Env[tc.envField] ?? undefined);
      expect(warnSpy).toHaveBeenCalledWith(
        "app_config_decrypt_failed",
        expect.objectContaining({ field: expect.any(String), reason: "malformed_input" }),
      );
    });

    it("falls back to Env when stored ciphertext fails tag verification", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ciphertext = encryptSecret(tc.dbValue);
      const [n, c] = ciphertext.split(":");
      const buf = Buffer.from(c, "base64");
      buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
      const tampered = `${n}:${buf.toString("base64")}`;
      await seedCache({ [tc.cacheField]: tampered } as never, cacheModule);
      expect(tc.resolver()).toBe(Env[tc.envField] ?? undefined);
      expect(warnSpy).toHaveBeenCalledWith(
        "app_config_decrypt_failed",
        expect.objectContaining({ reason: "tag_mismatch" }),
      );
    });

    it("falls back to Env when env key has rotated and no longer decrypts", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const ciphertext = encryptSecret(tc.dbValue);
      await seedCache({ [tc.cacheField]: ciphertext } as never, cacheModule);
      mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_APP_CONFIG_ENCRYPTION_KEY_ALT;
      expect(tc.resolver()).toBe(Env[tc.envField] ?? undefined);
    });

    it("does NOT include the plaintext in the decrypt-failed log payload", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ciphertext = encryptSecret(tc.dbValue);
      await seedCache({ [tc.cacheField]: ciphertext } as never, cacheModule);
      mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_APP_CONFIG_ENCRYPTION_KEY_ALT;
      tc.resolver();
      const allArgs = warnSpy.mock.calls.flat();
      for (const arg of allArgs) {
        expect(JSON.stringify(arg)).not.toContain(tc.dbValue);
      }
    });
  });
}
