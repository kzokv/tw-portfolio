import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { routeError } from "../lib/routeError.js";

const OAUTH_REDIRECT_BRIDGE_TTL_MS = 5 * 60 * 1000;

const redirectBridgePayloadSchema = z.object({
  redirectUrl: z.string().url(),
  exp: z.number().int(),
});

export function oauthRedirect(base: string, params: Record<string, string | undefined | null>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

function redirectBridgeKey(secret: string): Buffer {
  return createHash("sha256").update(`vakwen:mcp-oauth-redirect:${secret}`).digest();
}

function sealOAuthRedirectBridgePayload(secret: string, redirectUrl: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", redirectBridgeKey(secret), iv);
  const plaintext = JSON.stringify({
    redirectUrl,
    exp: Date.now() + OAUTH_REDIRECT_BRIDGE_TTL_MS,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function openOAuthRedirectBridgePayload(secret: string, payload: string): string {
  let sealed: Buffer;
  try {
    sealed = Buffer.from(payload, "base64url");
  } catch {
    throw routeError(400, "invalid_request", "OAuth redirect payload is invalid");
  }
  if (sealed.length <= 28) {
    throw routeError(400, "invalid_request", "OAuth redirect payload is invalid");
  }
  try {
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(12, 28);
    const ciphertext = sealed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", redirectBridgeKey(secret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = redirectBridgePayloadSchema.parse(JSON.parse(plaintext));
    if (parsed.exp < Date.now()) {
      throw routeError(400, "invalid_request", "OAuth redirect payload is expired");
    }
    return parsed.redirectUrl;
  } catch (err) {
    if (err instanceof Error && "statusCode" in err) throw err;
    throw routeError(400, "invalid_request", "OAuth redirect payload is invalid");
  }
}

export function oauthRedirectViaIssuer(input: {
  issuer: string;
  secret: string;
  finalRedirectUrl: string;
}): string {
  const payload = sealOAuthRedirectBridgePayload(input.secret, input.finalRedirectUrl);
  const bridgeUrl = new URL(`${input.issuer}/oauth/redirect`);
  bridgeUrl.searchParams.set("payload", payload);
  return bridgeUrl.toString();
}
