// KZO-198 — Unit tests for the AES-256-GCM Tier 0 secret encryption module.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_APP_CONFIG_ENCRYPTION_KEY,
  TEST_APP_CONFIG_ENCRYPTION_KEY_ALT,
} from "../../fixtures/appConfigEncryptionKey.js";

// Env is parsed once at module load and frozen — to drive APP_CONFIG_ENCRYPTION_KEY
// through the encryption module we must override it via vi.mock and
// per-test mutation of the mocked Env shape. `Object.assign` mutates the
// (non-frozen, in this mock) Env property in place so loadKey() reads the
// current per-test value.
const mockEnv: { APP_CONFIG_ENCRYPTION_KEY?: string } = {
  APP_CONFIG_ENCRYPTION_KEY: TEST_APP_CONFIG_ENCRYPTION_KEY,
};
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: new Proxy(
      { ...original.Env },
      {
        get(target, prop) {
          if (prop === "APP_CONFIG_ENCRYPTION_KEY") return mockEnv.APP_CONFIG_ENCRYPTION_KEY;
          return (target as Record<string | symbol, unknown>)[prop];
        },
      },
    ),
  };
});

import type { AppConfigDecryptError as AppConfigDecryptErrorType } from "../../../src/services/appConfig/encryption.js";
const {
  AppConfigDecryptError,
  decryptSecret,
  encryptSecret,
} = await import("../../../src/services/appConfig/encryption.js");
// Re-export the type alias so the rest of the file can use `as AppConfigDecryptError`
type AppConfigDecryptError = AppConfigDecryptErrorType;

beforeEach(() => {
  mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_APP_CONFIG_ENCRYPTION_KEY;
});

afterEach(() => {
  mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_APP_CONFIG_ENCRYPTION_KEY;
});

// ── round-trip ───────────────────────────────────────────────────────────────

describe("encryptSecret/decryptSecret — round-trip", () => {
  it("round-trips a 32-char ASCII plaintext", () => {
    const plaintext = "abcdefghijklmnopqrstuvwxyz012345";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("round-trips a Tier 0 minimum-length plaintext (20 chars)", () => {
    const plaintext = "a".repeat(20);
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("round-trips a Tier 0 maximum-length plaintext (500 chars)", () => {
    const plaintext = "x".repeat(500);
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("round-trips plaintext containing the ':' separator", () => {
    const plaintext = "https://example.com:443/api/key:value:more";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("emits a fresh nonce per call (two encrypts of same plaintext differ)", () => {
    const plaintext = "deterministic-input-xxxxxxxxxxx";
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("returns base64 nonce:base64 ciphertext shape (exactly one ':')", () => {
    const stored = encryptSecret("some-finmind-token-xxxxxxxxxxxx");
    expect(stored.split(":").length - 1).toBe(1);
    const [nonceB64, cipherB64] = stored.split(":");
    expect(nonceB64.length).toBeGreaterThan(0);
    expect(cipherB64.length).toBeGreaterThan(0);
    expect(nonceB64).toMatch(/^[A-Za-z0-9+/=_-]+$/);
    expect(cipherB64).toMatch(/^[A-Za-z0-9+/=_-]+$/);
  });
});

// ── tampered ciphertext ──────────────────────────────────────────────────────

describe("decryptSecret — tampered ciphertext", () => {
  it("throws AppConfigDecryptError(reason='tag_mismatch') when ciphertext byte is flipped", () => {
    const stored = encryptSecret("plaintext-to-be-tampered-xxxxxx");
    const [nonceB64, cipherB64] = stored.split(":");
    const buf = Buffer.from(cipherB64, "base64");
    // Flip a byte in the ciphertext region (not the tag) — the trailing 16 bytes are tag.
    buf[0] = buf[0] ^ 0xff;
    const tampered = `${nonceB64}:${buf.toString("base64")}`;
    try {
      decryptSecret(tampered);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("tag_mismatch");
    }
  });

  it("throws AppConfigDecryptError(reason='tag_mismatch') when the auth tag is altered", () => {
    const stored = encryptSecret("plaintext-tag-tamper-xxxxxxxxxx");
    const [nonceB64, cipherB64] = stored.split(":");
    const buf = Buffer.from(cipherB64, "base64");
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
    const tampered = `${nonceB64}:${buf.toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow(AppConfigDecryptError);
  });

  it("throws AppConfigDecryptError(reason='tag_mismatch') when nonce is replaced with a different valid 12-byte b64", () => {
    const stored = encryptSecret("plaintext-nonce-swap-xxxxxxxxxx");
    const [, cipherB64] = stored.split(":");
    const altNonce = Buffer.alloc(12, 0xab).toString("base64");
    const tampered = `${altNonce}:${cipherB64}`;
    try {
      decryptSecret(tampered);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("tag_mismatch");
    }
  });
});

// ── bad key ──────────────────────────────────────────────────────────────────

describe("decryptSecret — bad key", () => {
  it("throws AppConfigDecryptError(reason='bad_key') when env key length is not 64 hex chars", () => {
    const stored = encryptSecret("plaintext-good-key-xxxxxxxxxxxx");
    mockEnv.APP_CONFIG_ENCRYPTION_KEY = "0123456789abcdef"; // 16 chars
    try {
      decryptSecret(stored);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("bad_key");
    }
  });

  it("throws AppConfigDecryptError(reason='bad_key') when env key contains non-hex characters", () => {
    const stored = encryptSecret("plaintext-good-key-xxxxxxxxxxxx");
    mockEnv.APP_CONFIG_ENCRYPTION_KEY =
      "Z123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    try {
      decryptSecret(stored);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("bad_key");
    }
  });

  it("throws AppConfigDecryptError when called under a different valid key than was used to encrypt (cross-key)", () => {
    const stored = encryptSecret("plaintext-rotated-key-xxxxxxxxx");
    mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_APP_CONFIG_ENCRYPTION_KEY_ALT;
    expect(() => decryptSecret(stored)).toThrow(AppConfigDecryptError);
  });
});

// ── malformed input ──────────────────────────────────────────────────────────

describe("decryptSecret — malformed input", () => {
  it("throws AppConfigDecryptError(reason='malformed_input') when stored has no ':'", () => {
    try {
      decryptSecret("YWJjZGVmZ2hpamtsbW5vcA==");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("malformed_input");
    }
  });

  it("throws AppConfigDecryptError(reason='malformed_input') when stored has more than one ':'", () => {
    try {
      decryptSecret("aGVsbG8=:d29ybGQ=:Zm9v");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("malformed_input");
    }
  });

  it("throws AppConfigDecryptError(reason='malformed_input') when ciphertext segment is empty", () => {
    try {
      decryptSecret("aGVsbG8=:");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("malformed_input");
    }
  });

  it("throws AppConfigDecryptError(reason='malformed_input') when stored is the empty string", () => {
    try {
      decryptSecret("");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("malformed_input");
    }
  });

  it("throws AppConfigDecryptError(reason='malformed_input') when nonce length is wrong (not 12 bytes)", () => {
    // Nonce too short: 8 bytes b64-encoded.
    const shortNonce = Buffer.alloc(8, 0).toString("base64");
    const ctTag = Buffer.alloc(32, 0).toString("base64");
    try {
      decryptSecret(`${shortNonce}:${ctTag}`);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("malformed_input");
    }
  });
});

// ── empty plaintext (boundary) ──────────────────────────────────────────────

describe("encryptSecret — empty plaintext boundary", () => {
  it("encryptSecret rejects empty plaintext with AppConfigDecryptError(reason='malformed_input')", () => {
    // KZO-198 architect amendment 3 — `encryptSecret` rejects empty input at
    // the entry guard. Restores encrypt/decrypt symmetry; `decryptSecret` has
    // always rejected the resulting tag-only shape.
    try {
      encryptSecret("");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppConfigDecryptError);
      expect((err as AppConfigDecryptError).reason).toBe("malformed_input");
    }
  });
});
