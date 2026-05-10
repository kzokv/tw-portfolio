import { randomBytes } from "node:crypto";

const BASE62_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 22;

// Rejection-sampling threshold: only bytes strictly below this value map evenly
// onto the 62-char alphabet (256 - 256 % 62 = 248). Bytes 248..255 are discarded.
const REJECTION_THRESHOLD = Math.floor(256 / BASE62_ALPHABET.length) * BASE62_ALPHABET.length;

export function generateAnonymousShareToken(): string {
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    const buf = randomBytes(TOKEN_LENGTH * 2);
    for (let i = 0; i < buf.length && out.length < TOKEN_LENGTH; i += 1) {
      const b = buf[i]!;
      if (b < REJECTION_THRESHOLD) {
        out += BASE62_ALPHABET[b % BASE62_ALPHABET.length];
      }
    }
  }
  return out;
}

export const ANONYMOUS_SHARE_TOKEN_LENGTH = TOKEN_LENGTH;
export const ANONYMOUS_SHARE_TOKEN_REGEX = /^[A-Za-z0-9]{22}$/;
// KZO-199: ANONYMOUS_SHARE_TOKEN_CAP and ANONYMOUS_SHARE_TOKEN_RETENTION_MS
// constants removed. Use the resolver-backed helpers in
// `apps/api/src/services/appConfig/sharing.ts` (DB override → env-fallback)
// when reading the effective values at method-call time.
