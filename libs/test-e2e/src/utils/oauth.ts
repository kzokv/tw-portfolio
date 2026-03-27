/**
 * OAuth state parameter utilities for E2E tests.
 *
 * State format: `payload.signature` (2-part) or `payload.returnTo.signature` (3-part).
 * These are standalone helpers for 5e API tests that don't use the full AAA assistant framework.
 */

export interface TParsedOAuthState {
  /** The raw dot-separated segments */
  segments: string[];
  /** Number of segments (2 = no returnTo, 3 = has returnTo) */
  segmentCount: number;
  /** The signature segment (always the last) */
  signature: string;
}

/** Parse an OAuth state parameter into its dot-separated components. */
export function parseOAuthState(state: string): TParsedOAuthState {
  const segments = state.split(".");
  return {
    segments,
    segmentCount: segments.length,
    signature: segments[segments.length - 1] ?? "",
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
