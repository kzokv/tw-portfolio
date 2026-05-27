import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance } from "fastify";
import { routeError } from "../lib/routeError.js";
import { decryptSecret } from "../services/appConfig/encryption.js";

export function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function getMcpOAuthTokenSecret(app: FastifyInstance): Promise<string> {
  const config = await app.persistence.getAppConfig();
  if (!config.mcpOauthTokenSecretEncrypted) {
    throw routeError(503, "mcp_oauth_secret_unconfigured", "MCP OAuth token secret is not configured");
  }
  return decryptSecret(config.mcpOauthTokenSecretEncrypted);
}

export function hashMcpOAuthToken(secret: string, token: string): string {
  return hmac(secret, `mcp-oauth-token:${token}`);
}
