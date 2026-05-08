/**
 * KZO-198 — Tier 0 provider key resolvers (FinMind + Twelve Data).
 *
 * Each getter:
 *   1. Read the encrypted storage shape from the cache (or null on miss).
 *   2. If absent → return the env-var fallback (production deploys may rely
 *      solely on env, never having written a DB override).
 *   3. If present → attempt `decryptSecret`. On failure: log
 *      `app_config_decrypt_failed` once per call, emit a `provider_health`
 *      warning if a sink is wired in (out of scope for this resolver — the
 *      caller can subscribe to log lines), and fall back to env.
 *
 * The decrypt try/catch is narrow and re-throws ONLY non-`AppConfigDecryptError`
 * instances so callers see the typed signal where the design intends graceful
 * degradation (`.claude/rules/typed-transient-error-catch-audit.md`).
 *
 * Resolvers run on every fetch (no client rebuild on rotation) per scope-todo
 * Phase 3 — TTL cache is the only freshness lever.
 */
import { Env } from "@tw-portfolio/config";
import { AppConfigDecryptError, decryptSecret } from "./encryption.js";
import { getAppConfigCacheEntry } from "./cache.js";

interface DecryptOptions {
  field: "finmind_api_token" | "twelve_data_api_key";
  encrypted: string;
  envFallback: string | undefined;
}

function decryptOrFallback({ field, encrypted, envFallback }: DecryptOptions): string | undefined {
  try {
    return decryptSecret(encrypted);
  } catch (err) {
    if (err instanceof AppConfigDecryptError) {
      console.warn(
        "app_config_decrypt_failed",
        { field, reason: err.reason, message: err.message },
      );
      return envFallback;
    }
    // Non-decrypt errors (programmer bugs, OOM, etc.) MUST propagate.
    throw err;
  }
}

/**
 * Effective FinMind API token. DB override (decrypted on read) wins; falls back
 * to `Env.FINMIND_API_TOKEN` on cache miss / NULL / decryption failure.
 * Returns `undefined` when both sources are absent — callers handle the
 * "no token configured" branch as before.
 */
export function getEffectiveFinmindApiToken(): string | undefined {
  const encrypted = getAppConfigCacheEntry()?.finmindApiTokenEncrypted ?? null;
  if (encrypted === null) {
    return Env.FINMIND_API_TOKEN ?? undefined;
  }
  return decryptOrFallback({
    field: "finmind_api_token",
    encrypted,
    envFallback: Env.FINMIND_API_TOKEN ?? undefined,
  });
}

/**
 * Effective Twelve Data API key. Same fallback semantics as
 * `getEffectiveFinmindApiToken`.
 */
export function getEffectiveTwelveDataApiKey(): string | undefined {
  const encrypted = getAppConfigCacheEntry()?.twelveDataApiKeyEncrypted ?? null;
  if (encrypted === null) {
    return Env.TWELVE_DATA_API_KEY ?? undefined;
  }
  return decryptOrFallback({
    field: "twelve_data_api_key",
    encrypted,
    envFallback: Env.TWELVE_DATA_API_KEY ?? undefined,
  });
}
