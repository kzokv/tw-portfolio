/**
 * OAuth state parameter utilities for E2E tests.
 *
 * State format:
 * - `nonce.signature` (2-part)
 * - `nonce.returnTo_b64.signature` (3-part)
 * - `nonce.returnTo_b64.inviteCode.signature` (4-part)
 *
 * These are standalone helpers for 5e API tests that don't use the full AAA assistant framework.
 */

export interface TParsedOAuthState {
  /** The raw dot-separated segments */
  segments: string[];
  /** Number of segments (2 = no returnTo, 3 = has returnTo, 4 = has returnTo + invite code) */
  segmentCount: number;
  /** The unsigned payload (all segments except the final signature) */
  unsignedPayload: string;
  /** The nonce segment (always first) */
  nonce: string;
  /** The returnTo segment when present */
  returnToBase64: string | undefined;
  /** The invite code segment when present */
  inviteCode: string | undefined;
  /** The signature segment (always the last) */
  signature: string;
}

/** Parse an OAuth state parameter into its dot-separated components. */
export function parseOAuthState(state: string): TParsedOAuthState {
  const segments = state.split(".");
  const nonce = segments[0] ?? "";
  const second = segments[1];
  const third = segments[2];
  const signature = segments[segments.length - 1] ?? "";
  return {
    segments,
    segmentCount: segments.length,
    unsignedPayload: segments.slice(0, -1).join("."),
    nonce,
    returnToBase64: segments.length >= 3 ? second : undefined,
    inviteCode: segments.length >= 4 ? third : undefined,
    signature,
  };
}

/**
 * Tamper with a signed value by replacing its HMAC signature.
 * Useful for testing invalid-state error paths.
 */
export function tamperSignedValue(value: string): string {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return value;
  return `${value.slice(0, lastDot + 1)}badhmacsignature`;
}

/**
 * Extract the OAuth state parameter from a redirect Location URL.
 * Returns the `state` query parameter value, or empty string if absent.
 */
export function extractOAuthStateFromUrl(locationUrl: string): string {
  return new URL(locationUrl).searchParams.get("state") ?? "";
}
