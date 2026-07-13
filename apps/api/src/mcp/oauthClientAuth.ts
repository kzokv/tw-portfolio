import { Buffer } from "node:buffer";
import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";
import type { AiConnectorClientKind, AiConnectorVendor } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";

const CLIENT_METADATA_FETCH_TIMEOUT_MS = 3_000;
const CLIENT_METADATA_MAX_BYTES = 64 * 1024;
const CLIENT_ASSERTION_CLOCK_SKEW_SECONDS = 60;
const CLIENT_ASSERTION_MAX_TTL_SECONDS = 10 * 60;

export const CLIENT_ASSERTION_TYPE_JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
export const CLIENT_ASSERTION_MAX_CHARS = 16 * 1024;

type ClientMetadataAddress = {
  address: string;
  family: 4 | 6;
};

type ClientMetadataFetchResult = {
  statusCode: number;
  contentLength: number | null;
  body: string;
};

type ResolveClientMetadataHost = (hostname: string) => Promise<ClientMetadataAddress[]>;

type ReadClientMetadataDocument = (
  url: URL,
  address: ClientMetadataAddress,
  signal: AbortSignal,
) => Promise<ClientMetadataFetchResult>;

type PinnedLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type OAuthTokenClientAuthInput = {
  client_id: string;
  client_assertion_type?: string;
  client_assertion?: string;
};

class ClientMetadataTooLargeError extends Error {}

let resolveClientMetadataHost: ResolveClientMetadataHost = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
};

let readClientMetadataDocument: ReadClientMetadataDocument = readHttpsClientMetadataDocument;

export function createPinnedClientMetadataLookup(address: ClientMetadataAddress) {
  return (
    _hostname: string,
    options: LookupOptions,
    callback: PinnedLookupCallback,
  ): void => {
    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

export function setMcpOAuthClientMetadataNetworkForTest(
  hooks: Partial<{
    resolveHost: ResolveClientMetadataHost;
    readDocument: ReadClientMetadataDocument;
  }>,
): () => void {
  const previousResolve = resolveClientMetadataHost;
  const previousRead = readClientMetadataDocument;
  if (hooks.resolveHost) resolveClientMetadataHost = hooks.resolveHost;
  if (hooks.readDocument) readClientMetadataDocument = hooks.readDocument;
  return () => {
    resolveClientMetadataHost = previousResolve;
    readClientMetadataDocument = previousRead;
  };
}

const clientMetadataDocumentSchema = z.object({
  client_id: z.string().url(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().url()).min(1),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).min(1).optional(),
  token_endpoint_auth_signing_alg: z.string().optional(),
  jwks_uri: z.string().url().optional(),
}).passthrough();

const jwkSchema = z.object({
  kty: z.string(),
  kid: z.string().optional(),
  alg: z.string().optional(),
  use: z.string().optional(),
  n: z.string().optional(),
  e: z.string().optional(),
}).passthrough();

const jwksDocumentSchema = z.object({
  keys: z.array(jwkSchema).min(1),
}).passthrough();

const clientAssertionHeaderSchema = z.object({
  alg: z.literal("RS256"),
  kid: z.string().min(1).optional(),
}).passthrough();

const clientAssertionPayloadSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  exp: z.number().int(),
  iat: z.number().int().optional(),
  nbf: z.number().int().optional(),
  jti: z.string().min(1).optional(),
}).passthrough();

type ClientMetadataDocument = z.infer<typeof clientMetadataDocumentSchema>;
type JwkDocumentKey = z.infer<typeof jwkSchema>;
type TokenEndpointAuthMethod = "none" | "private_key_jwt";

const CLAUDE_AI_METADATA_URL = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = new Set<TokenEndpointAuthMethod>(["none", "private_key_jwt"]);

export interface McpOAuthClientIdentity {
  clientKind: AiConnectorClientKind;
  label: string;
  vendor: AiConnectorVendor;
}

export interface InspectedOAuthClient {
  identity: McpOAuthClientIdentity;
  metadata: ClientMetadataDocument | null;
}

function parseUrlClientId(clientId: string): URL | null {
  try {
    return new URL(clientId);
  } catch {
    return null;
  }
}

function detectOAuthClientIdentity(clientId: string, metadata: ClientMetadataDocument | null): McpOAuthClientIdentity {
  const canonicalClientId = metadata?.client_id ?? clientId;
  const parsedClientId = parseUrlClientId(canonicalClientId);
  if (canonicalClientId === CLAUDE_AI_METADATA_URL || parsedClientId?.hostname === "claude.ai") {
    return {
      vendor: "anthropic",
      clientKind: "claude_ai_connector",
      label: "Claude.ai",
    };
  }
  return parsedClientId
    ? {
        vendor: "openai",
        clientKind: "chatgpt_app",
        label: "ChatGPT / OpenAI Apps",
      }
    : {
        vendor: "openai",
        clientKind: "chatgpt_app",
        label: "ChatGPT / OpenAI Apps",
      };
}

function isSupportedTokenEndpointAuthMethod(value: string): value is TokenEndpointAuthMethod {
  return SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.has(value as TokenEndpointAuthMethod);
}

function getSupportedTokenEndpointAuthMethods(metadata: ClientMetadataDocument): Set<TokenEndpointAuthMethod> {
  if (metadata.token_endpoint_auth_methods_supported) {
    const supported = metadata.token_endpoint_auth_methods_supported.filter(isSupportedTokenEndpointAuthMethod);
    if (supported.length === 0) {
      throw routeError(400, "invalid_client", "Client metadata document uses an unsupported token auth method");
    }
    return new Set(supported);
  }
  const tokenAuthMethod = metadata.token_endpoint_auth_method ?? "none";
  if (!isSupportedTokenEndpointAuthMethod(tokenAuthMethod)) {
    throw routeError(400, "invalid_client", "Client metadata document uses an unsupported token auth method");
  }
  return new Set([tokenAuthMethod]);
}

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  );
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:")
  );
}

function privateIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return privateIpv4(address);
  if (family === 6) return privateIpv6(address);
  return true;
}

function normalizeContentLength(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readHttpsClientMetadataDocument(
  url: URL,
  address: ClientMetadataAddress,
  signal: AbortSignal,
): Promise<ClientMetadataFetchResult> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET",
      headers: { accept: "application/json" },
      lookup: createPinnedClientMetadataLookup(address),
      signal,
    }, (res) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const contentLength = normalizeContentLength(res.headers["content-length"]);
      if (contentLength !== null && contentLength > CLIENT_METADATA_MAX_BYTES) {
        res.destroy(new ClientMetadataTooLargeError());
        return;
      }
      res.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.byteLength;
        if (totalBytes > CLIENT_METADATA_MAX_BYTES) {
          res.destroy(new ClientMetadataTooLargeError());
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          contentLength,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

async function assertPublicHttpsDocumentUrlFetchable(
  url: URL,
  messages: {
    protocol: string;
    invalidUrl: string;
    hostNotAllowed: string;
  },
): Promise<ClientMetadataAddress> {
  if (url.protocol !== "https:") {
    throw routeError(400, "invalid_client", messages.protocol);
  }
  if (url.username || url.password) {
    throw routeError(400, "invalid_client", messages.invalidUrl);
  }

  const directIp = isIP(url.hostname);
  if (directIp !== 0 && privateIp(url.hostname)) {
    throw routeError(400, "invalid_client", messages.hostNotAllowed);
  }
  if (directIp !== 0) {
    return { address: url.hostname, family: directIp === 6 ? 6 : 4 };
  }

  const records = await resolveClientMetadataHost(url.hostname);
  if (records.length === 0 || records.some((record) => privateIp(record.address))) {
    throw routeError(400, "invalid_client", messages.hostNotAllowed);
  }
  return records[0]!;
}

async function assertClientMetadataUrlFetchable(url: URL): Promise<ClientMetadataAddress> {
  if (url.pathname === "/" || url.pathname === "") {
    throw routeError(400, "invalid_client", "URL client_id metadata document URL is invalid");
  }
  return assertPublicHttpsDocumentUrlFetchable(url, {
    protocol: "URL client_id metadata documents must use HTTPS",
    invalidUrl: "URL client_id metadata document URL is invalid",
    hostNotAllowed: "URL client_id metadata document host is not allowed",
  });
}

async function assertClientJwksUrlFetchable(url: URL): Promise<ClientMetadataAddress> {
  return assertPublicHttpsDocumentUrlFetchable(url, {
    protocol: "Client JWKS document must use HTTPS",
    invalidUrl: "Client JWKS document URL is invalid",
    hostNotAllowed: "Client JWKS document host is not allowed",
  });
}

async function fetchClientMetadataDocument(clientId: string) {
  const url = parseUrlClientId(clientId);
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_METADATA_FETCH_TIMEOUT_MS);
  try {
    const address = await assertClientMetadataUrlFetchable(url);
    const response = await readClientMetadataDocument(url, address, controller.signal);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw routeError(400, "invalid_client", "URL client_id metadata document could not be loaded");
    }
    if (response.contentLength !== null && response.contentLength > CLIENT_METADATA_MAX_BYTES) {
      throw routeError(400, "invalid_client", "URL client_id metadata document is too large");
    }
    const metadataText = response.body;
    if (Buffer.byteLength(metadataText, "utf8") > CLIENT_METADATA_MAX_BYTES) {
      throw routeError(400, "invalid_client", "URL client_id metadata document is too large");
    }
    return clientMetadataDocumentSchema.parse(JSON.parse(metadataText) as unknown);
  } catch (error) {
    if (error instanceof ClientMetadataTooLargeError) {
      throw routeError(400, "invalid_client", "URL client_id metadata document is too large");
    }
    if (error instanceof Error && "statusCode" in error) throw error;
    throw routeError(400, "invalid_client", "URL client_id metadata document is invalid");
  } finally {
    clearTimeout(timer);
  }
}

function validateClientMetadataBasics(metadata: ClientMetadataDocument, clientId: string): void {
  if (metadata.client_id !== clientId) {
    throw routeError(400, "invalid_client", "URL client_id metadata document does not match client_id");
  }
  if (metadata.grant_types && !metadata.grant_types.includes("authorization_code")) {
    throw routeError(400, "invalid_client", "Client metadata document does not support authorization_code");
  }
  if (metadata.response_types && !metadata.response_types.includes("code")) {
    throw routeError(400, "invalid_client", "Client metadata document does not support code response type");
  }
  const tokenAuthMethods = getSupportedTokenEndpointAuthMethods(metadata);
  if (tokenAuthMethods.has("private_key_jwt")) {
    if (!metadata.jwks_uri) {
      throw routeError(400, "invalid_client", "Client metadata document must include jwks_uri for private_key_jwt");
    }
    if (metadata.token_endpoint_auth_signing_alg && metadata.token_endpoint_auth_signing_alg !== "RS256") {
      throw routeError(400, "invalid_client", "Client metadata document uses an unsupported token auth signing algorithm");
    }
  }
}

export async function validateOAuthClient(clientId: string, redirectUri: string): Promise<void> {
  const metadata = await fetchClientMetadataDocument(clientId);
  if (!metadata) return;
  validateClientMetadataBasics(metadata, clientId);
  if (!metadata.redirect_uris.includes(redirectUri)) {
    throw routeError(400, "invalid_request", "OAuth redirect_uri is not registered by the client metadata document");
  }
}

export async function inspectOAuthClient(clientId: string, redirectUri?: string): Promise<InspectedOAuthClient> {
  const metadata = await fetchClientMetadataDocument(clientId);
  if (metadata) {
    validateClientMetadataBasics(metadata, clientId);
    if (redirectUri && !metadata.redirect_uris.includes(redirectUri)) {
      throw routeError(400, "invalid_request", "OAuth redirect_uri is not registered by the client metadata document");
    }
  }
  return {
    identity: detectOAuthClientIdentity(clientId, metadata),
    metadata,
  };
}

async function fetchClientJwksDocument(jwksUri: string) {
  const url = new URL(jwksUri);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_METADATA_FETCH_TIMEOUT_MS);
  try {
    const address = await assertClientJwksUrlFetchable(url);
    const response = await readClientMetadataDocument(url, address, controller.signal);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw routeError(400, "invalid_client", "Client JWKS document could not be loaded");
    }
    if (response.contentLength !== null && response.contentLength > CLIENT_METADATA_MAX_BYTES) {
      throw routeError(400, "invalid_client", "Client JWKS document is too large");
    }
    const jwksText = response.body;
    if (Buffer.byteLength(jwksText, "utf8") > CLIENT_METADATA_MAX_BYTES) {
      throw routeError(400, "invalid_client", "Client JWKS document is too large");
    }
    return jwksDocumentSchema.parse(JSON.parse(jwksText) as unknown);
  } catch (error) {
    if (error instanceof ClientMetadataTooLargeError) {
      throw routeError(400, "invalid_client", "Client JWKS document is too large");
    }
    if (error instanceof Error && "statusCode" in error) throw error;
    throw routeError(400, "invalid_client", "Client JWKS document is invalid");
  } finally {
    clearTimeout(timer);
  }
}

function parseJwtPart(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw routeError(400, "invalid_client", "Client assertion JWT is invalid");
  }
}

function jwkCanVerifyAssertion(jwk: JwkDocumentKey, kid: string | undefined): boolean {
  if (jwk.kty !== "RSA") return false;
  if (jwk.use && jwk.use !== "sig") return false;
  if (jwk.alg && jwk.alg !== "RS256") return false;
  if (kid && jwk.kid !== kid) return false;
  return Boolean(jwk.n && jwk.e);
}

function publicKeyFromJwk(jwk: JwkDocumentKey): KeyObject | null {
  try {
    return createPublicKey({
      key: jwk as JsonWebKey,
      format: "jwk",
    });
  } catch {
    return null;
  }
}

function verifyClientAssertionSignature(
  assertion: string,
  keys: JwkDocumentKey[],
  kid: string | undefined,
): boolean {
  const [encodedHeader, encodedPayload, encodedSignature] = assertion.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature || assertion.split(".").length !== 3) {
    throw routeError(400, "invalid_client", "Client assertion JWT is invalid");
  }
  const signature = Buffer.from(encodedSignature, "base64url");
  const signedContent = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
  return keys
    .filter((jwk) => jwkCanVerifyAssertion(jwk, kid))
    .some((jwk) => {
      const key = publicKeyFromJwk(jwk);
      return key ? verifySignature("RSA-SHA256", signedContent, key, signature) : false;
    });
}

function assertClientAssertionClaims(input: {
  payload: z.infer<typeof clientAssertionPayloadSchema>;
  clientId: string;
  tokenEndpoint: string;
  nowSeconds?: number;
}): void {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (input.payload.iss !== input.clientId || input.payload.sub !== input.clientId) {
    throw routeError(400, "invalid_client", "Client assertion issuer or subject is invalid");
  }
  const audience = Array.isArray(input.payload.aud) ? input.payload.aud : [input.payload.aud];
  if (!audience.includes(input.tokenEndpoint)) {
    throw routeError(400, "invalid_client", "Client assertion audience is invalid");
  }
  if (input.payload.exp <= nowSeconds - CLIENT_ASSERTION_CLOCK_SKEW_SECONDS) {
    throw routeError(400, "invalid_client", "Client assertion has expired");
  }
  if (input.payload.exp > nowSeconds + CLIENT_ASSERTION_MAX_TTL_SECONDS + CLIENT_ASSERTION_CLOCK_SKEW_SECONDS) {
    throw routeError(400, "invalid_client", "Client assertion expiry is too far in the future");
  }
  if (input.payload.iat && input.payload.iat > nowSeconds + CLIENT_ASSERTION_CLOCK_SKEW_SECONDS) {
    throw routeError(400, "invalid_client", "Client assertion issued-at time is invalid");
  }
  if (input.payload.nbf && input.payload.nbf > nowSeconds + CLIENT_ASSERTION_CLOCK_SKEW_SECONDS) {
    throw routeError(400, "invalid_client", "Client assertion not-before time is invalid");
  }
}

async function validatePrivateKeyJwtClientAuth(input: {
  metadata: ClientMetadataDocument;
  clientId: string;
  assertion: string;
  tokenEndpoint: string;
}): Promise<void> {
  if (!input.metadata.jwks_uri) {
    throw routeError(400, "invalid_client", "Client metadata document must include jwks_uri for private_key_jwt");
  }
  const [encodedHeader, encodedPayload] = input.assertion.split(".");
  if (!encodedHeader || !encodedPayload || input.assertion.split(".").length !== 3) {
    throw routeError(400, "invalid_client", "Client assertion JWT is invalid");
  }
  const header = clientAssertionHeaderSchema.parse(parseJwtPart(encodedHeader));
  const payload = clientAssertionPayloadSchema.parse(parseJwtPart(encodedPayload));
  const jwks = await fetchClientJwksDocument(input.metadata.jwks_uri);
  if (!verifyClientAssertionSignature(input.assertion, jwks.keys, header.kid)) {
    throw routeError(400, "invalid_client", "Client assertion signature is invalid");
  }
  assertClientAssertionClaims({
    payload,
    clientId: input.clientId,
    tokenEndpoint: input.tokenEndpoint,
  });
}

export async function validateOAuthTokenClient(
  body: OAuthTokenClientAuthInput,
  tokenEndpoint: string,
): Promise<void> {
  const metadata = await fetchClientMetadataDocument(body.client_id);
  if (!metadata) {
    if (body.client_assertion || body.client_assertion_type) {
      throw routeError(400, "invalid_client", "Client assertion requires URL client metadata");
    }
    return;
  }
  validateClientMetadataBasics(metadata, body.client_id);
  const tokenAuthMethods = getSupportedTokenEndpointAuthMethods(metadata);
  const hasClientAssertion = Boolean(body.client_assertion || body.client_assertion_type);
  if (hasClientAssertion) {
    if (!tokenAuthMethods.has("private_key_jwt")) {
      throw routeError(400, "invalid_client", "Public OAuth client must not send a client assertion");
    }
    if (body.client_assertion_type !== CLIENT_ASSERTION_TYPE_JWT_BEARER || !body.client_assertion) {
      throw routeError(400, "invalid_client", "Client private_key_jwt assertion is required");
    }
    await validatePrivateKeyJwtClientAuth({
      metadata,
      clientId: body.client_id,
      assertion: body.client_assertion,
      tokenEndpoint,
    });
    return;
  }
  if (tokenAuthMethods.has("private_key_jwt")) {
    throw routeError(400, "invalid_client", "Client private_key_jwt assertion is required");
  }
  if (!tokenAuthMethods.has("none")) {
    throw routeError(400, "invalid_client", "Client private_key_jwt assertion is required");
  }
}
