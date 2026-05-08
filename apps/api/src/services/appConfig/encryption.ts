/**
 * KZO-198 — AES-256-GCM application-level encryption for Tier 0 secrets stored
 * in `app_config` (FinMind + Twelve Data API tokens).
 *
 * Storage shape: `${base64(nonce)}:${base64(ciphertext + auth tag)}`.
 * The trailing 16 bytes of the second segment are the GCM auth tag.
 *
 * Key:    `Env.APP_CONFIG_ENCRYPTION_KEY` — raw 32-byte key, 64 lowercase hex chars.
 * Nonce:  12 random bytes per encrypt (IV). Suitable for AES-GCM at this volume.
 * AAD:    none — single-key, single-purpose; domain separation is not needed yet.
 *
 * Decryption failures throw `AppConfigDecryptError`. Callers MUST catch + log
 * `app_config_decrypt_failed` + emit a `provider_health` warning + fall back to
 * the env value. See `apps/api/src/services/appConfig/providerKeys.ts` for the
 * canonical resolver-side handling. This is the typed-transient-error pattern
 * (`.claude/rules/typed-transient-error-catch-audit.md`): never let a generic
 * `try/catch` swallow `AppConfigDecryptError`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Env } from "@tw-portfolio/config";

const ALG = "aes-256-gcm";
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export type AppConfigDecryptReason =
  | "tag_mismatch"
  | "bad_key"
  | "malformed_input";

/**
 * Thrown by `decryptSecret` on any failure. Typed so resolver callers can
 * distinguish from generic errors (per `typed-transient-error-catch-audit.md`).
 */
export class AppConfigDecryptError extends Error {
  public readonly reason: AppConfigDecryptReason;
  constructor(reason: AppConfigDecryptReason, message: string) {
    super(message);
    this.name = "AppConfigDecryptError";
    this.reason = reason;
  }
}

function loadKey(): Buffer {
  const hex = Env.APP_CONFIG_ENCRYPTION_KEY;
  if (!hex) {
    throw new AppConfigDecryptError(
      "bad_key",
      "APP_CONFIG_ENCRYPTION_KEY is not set; cannot encrypt or decrypt app_config Tier 0 secrets.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new AppConfigDecryptError(
      "bad_key",
      "APP_CONFIG_ENCRYPTION_KEY must be 64 lowercase hex chars (32 bytes).",
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== KEY_LEN) {
    throw new AppConfigDecryptError(
      "bad_key",
      `APP_CONFIG_ENCRYPTION_KEY decoded to ${buf.length} bytes; expected ${KEY_LEN}.`,
    );
  }
  return buf;
}

/**
 * Encrypt a Tier 0 secret. Returns the storage shape `nonce_b64:ct+tag_b64`.
 * Throws `AppConfigDecryptError("bad_key", ...)` if the key env var is missing
 * or malformed (encryption and decryption share the same key-loading path).
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new AppConfigDecryptError(
      "malformed_input",
      "plaintext must be non-empty",
    );
  }
  const key = loadKey();
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALG, key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${nonce.toString("base64")}:${Buffer.concat([ct, tag]).toString("base64")}`;
}

/**
 * Decrypt a stored Tier 0 secret. Throws `AppConfigDecryptError` on:
 *   - malformed input shape (missing `:`, empty segment, base64 decode error)
 *   - bad key (env var missing / wrong length)
 *   - GCM tag mismatch (corruption, wrong key, or tampering)
 *
 * Resolver-layer callers MUST catch this and fall back to the env value
 * (per design.md §5 + providerKeys.ts).
 */
export function decryptSecret(stored: string): string {
  if (typeof stored !== "string" || stored.length === 0) {
    throw new AppConfigDecryptError("malformed_input", "encrypted value is empty");
  }
  const parts = stored.split(":");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new AppConfigDecryptError(
      "malformed_input",
      "encrypted value must be `nonce_b64:ciphertext_b64` (single colon, two non-empty segments)",
    );
  }
  const [nonceB64, ctTagB64] = parts;
  let nonce: Buffer;
  let ctTag: Buffer;
  try {
    nonce = Buffer.from(nonceB64, "base64");
    ctTag = Buffer.from(ctTagB64, "base64");
  } catch {
    throw new AppConfigDecryptError("malformed_input", "base64 decode failed");
  }
  if (nonce.length !== NONCE_LEN) {
    throw new AppConfigDecryptError("malformed_input", `nonce must be ${NONCE_LEN} bytes; got ${nonce.length}`);
  }
  if (ctTag.length < TAG_LEN + 1) {
    throw new AppConfigDecryptError("malformed_input", "ciphertext segment shorter than auth tag");
  }
  const tag = ctTag.subarray(ctTag.length - TAG_LEN);
  const ct = ctTag.subarray(0, ctTag.length - TAG_LEN);
  const key = loadKey();
  const decipher = createDecipheriv(ALG, key, nonce);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    throw new AppConfigDecryptError("tag_mismatch", "GCM auth tag verification failed");
  }
}
