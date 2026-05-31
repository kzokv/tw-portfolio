/**
 * Deterministic test fixture key for AppConfig encryption tests (KZO-198).
 *
 * 32-byte key encoded as 64 lowercase hex chars — matches the shape required
 * by `Env.APP_CONFIG_ENCRYPTION_KEY` (`/^[0-9a-f]{64}$/`). NEVER use in prod.
 */
export const TEST_APP_CONFIG_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * A second valid 64-hex key, used for cross-key decrypt-failure tests.
 * Distinct from the primary fixture key so that ciphertexts produced under
 * one fail tag verification under the other.
 */
export const TEST_APP_CONFIG_ENCRYPTION_KEY_ALT =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

/**
 * Set the encryption key on `process.env` for the duration of a single test.
 * Returns the previous value so callers can restore it in afterEach (or use
 * `vi.stubEnv` instead).
 */
export function withTestEncryptionKey(key: string = TEST_APP_CONFIG_ENCRYPTION_KEY): string | undefined {
  const previous = process.env.APP_CONFIG_ENCRYPTION_KEY;
  process.env.APP_CONFIG_ENCRYPTION_KEY = key;
  return previous;
}
