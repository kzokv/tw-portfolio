import { Buffer } from "node:buffer";
import {
  createPublicKey,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  AiConnectorPolicySettingsDto,
  AiConnectorScope,
  McpOAuthConsentDecisionDto,
  McpOAuthConsentRequestDto,
} from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import { decryptSecret } from "../services/appConfig/encryption.js";
import { ALL_MCP_SCOPES } from "./tools.js";
import type { McpProtectedResourceMetadata } from "./types.js";
import {
  connectorGroupForScope,
  revokeAiConnectorConnection,
} from "../services/mcpConnectorLifecycle.js";

const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 90;
const CLIENT_METADATA_FETCH_TIMEOUT_MS = 3_000;
const CLIENT_METADATA_MAX_BYTES = 64 * 1024;
const CONSENT_CSRF_VERSION = 1;
const CLIENT_ASSERTION_TYPE_JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const CLIENT_ASSERTION_MAX_CHARS = 16 * 1024;
const CLIENT_ASSERTION_CLOCK_SKEW_SECONDS = 60;
const CLIENT_ASSERTION_MAX_TTL_SECONDS = 10 * 60;

const CHATGPT_REDIRECT_HOSTS = new Set(["chat.openai.com", "chatgpt.com"]);

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

const scopeSchema = z.enum(ALL_MCP_SCOPES as [typeof ALL_MCP_SCOPES[0], ...typeof ALL_MCP_SCOPES]);

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().trim().min(1).max(2048),
  redirect_uri: z.string().url(),
  state: z.string().max(4096).optional(),
  resource: z.string().url(),
  scope: z.string().max(2000).optional(),
  code_challenge: z.string().trim().min(43).max(256),
  code_challenge_method: z.literal("S256"),
}).strict();

const tokenBodySchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().trim().min(1),
    redirect_uri: z.string().url(),
    client_id: z.string().trim().min(1).max(2048),
    code_verifier: z.string().trim().min(43).max(256),
    resource: z.string().url(),
    client_assertion_type: z.literal(CLIENT_ASSERTION_TYPE_JWT_BEARER).optional(),
    client_assertion: z.string().trim().min(1).max(CLIENT_ASSERTION_MAX_CHARS).optional(),
  }).strict(),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().trim().min(1),
    client_id: z.string().trim().min(1).max(2048),
    resource: z.string().url(),
    client_assertion_type: z.literal(CLIENT_ASSERTION_TYPE_JWT_BEARER).optional(),
    client_assertion: z.string().trim().min(1).max(CLIENT_ASSERTION_MAX_CHARS).optional(),
  }).strict(),
]);

const approveBodySchema = z.object({
  csrfToken: z.string().min(1),
  scopes: z.array(scopeSchema).min(1),
  lifetimeDays: z.number().int().min(1).optional(),
}).strict();

const denyBodySchema = z.object({
  csrfToken: z.string().min(1),
}).strict();

const accessTokenPayloadSchema = z.object({
  iss: z.string().url(),
  aud: z.string().url(),
  resource: z.string().url(),
  sub: z.string().min(1),
  connectionId: z.string().min(1),
  client_id: z.string().min(1),
  sv: z.number().int().nonnegative(),
  scope: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});

const clientMetadataDocumentSchema = z.object({
  client_id: z.string().url(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().url()).min(1),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
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

export type McpOAuthAccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;
type ClientMetadataDocument = z.infer<typeof clientMetadataDocumentSchema>;
type JwkDocumentKey = z.infer<typeof jwkSchema>;
type TokenRequestBody = z.infer<typeof tokenBodySchema>;

export function buildRequestOrigin(req: FastifyRequest): string {
  const protocol = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  const host = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:4000";
  return `${protocol ?? "http"}://${host}`;
}

function normalizeIssuer(value: string): string {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function localRuntime(): boolean {
  return Env.NODE_ENV === "test" || Env.NODE_ENV === "development";
}

function parseUrlClientId(clientId: string): URL | null {
  try {
    return new URL(clientId);
  } catch {
    return null;
  }
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
  const tokenAuthMethod = metadata.token_endpoint_auth_method ?? "none";
  if (tokenAuthMethod !== "none" && tokenAuthMethod !== "private_key_jwt") {
    throw routeError(400, "invalid_client", "Client metadata document uses an unsupported token auth method");
  }
  if (tokenAuthMethod === "private_key_jwt") {
    if (!metadata.jwks_uri) {
      throw routeError(400, "invalid_client", "Client metadata document must include jwks_uri for private_key_jwt");
    }
    if (metadata.token_endpoint_auth_signing_alg && metadata.token_endpoint_auth_signing_alg !== "RS256") {
      throw routeError(400, "invalid_client", "Client metadata document uses an unsupported token auth signing algorithm");
    }
  }
}

async function validateOAuthClient(clientId: string, redirectUri: string): Promise<void> {
  const metadata = await fetchClientMetadataDocument(clientId);
  if (!metadata) return;
  validateClientMetadataBasics(metadata, clientId);
  if (!metadata.redirect_uris.includes(redirectUri)) {
    throw routeError(400, "invalid_request", "OAuth redirect_uri is not registered by the client metadata document");
  }
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

async function validateOAuthTokenClient(
  app: FastifyInstance,
  req: FastifyRequest,
  body: TokenRequestBody,
): Promise<void> {
  const metadata = await fetchClientMetadataDocument(body.client_id);
  if (!metadata) {
    if (body.client_assertion || body.client_assertion_type) {
      throw routeError(400, "invalid_client", "Client assertion requires URL client metadata");
    }
    return;
  }
  validateClientMetadataBasics(metadata, body.client_id);
  const tokenAuthMethod = metadata.token_endpoint_auth_method ?? "none";
  if (tokenAuthMethod === "none") {
    if (body.client_assertion || body.client_assertion_type) {
      throw routeError(400, "invalid_client", "Public OAuth client must not send a client assertion");
    }
    return;
  }
  if (tokenAuthMethod !== "private_key_jwt") {
    throw routeError(400, "invalid_client", "Client metadata document uses an unsupported token auth method");
  }
  if (body.client_assertion_type !== CLIENT_ASSERTION_TYPE_JWT_BEARER || !body.client_assertion) {
    throw routeError(400, "invalid_client", "Client private_key_jwt assertion is required");
  }
  await validatePrivateKeyJwtClientAuth({
    metadata,
    clientId: body.client_id,
    assertion: body.client_assertion,
    tokenEndpoint: `${await getMcpOAuthIssuer(app, req)}/oauth/token`,
  });
}

function assertIssuerAllowed(issuer: string): string {
  const url = new URL(issuer);
  if (url.protocol === "https:") return issuer;
  if (localRuntime() && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return issuer;
  throw routeError(503, "mcp_oauth_issuer_unconfigured", "MCP OAuth public issuer must be configured with HTTPS");
}

export async function getMcpOAuthIssuer(app: FastifyInstance, req: FastifyRequest): Promise<string> {
  const settings = await app.persistence.getAiConnectorPolicySettings();
  if (settings.oauthPublicIssuer) {
    return assertIssuerAllowed(normalizeIssuer(settings.oauthPublicIssuer));
  }
  if (!localRuntime()) {
    throw routeError(503, "mcp_oauth_issuer_unconfigured", "MCP OAuth public issuer must be configured");
  }
  return assertIssuerAllowed(normalizeIssuer(buildRequestOrigin(req)));
}

export async function getMcpResourceUrl(app: FastifyInstance, req: FastifyRequest): Promise<string> {
  return `${await getMcpOAuthIssuer(app, req)}/mcp`;
}

export async function getMcpProtectedResourceMetadata(
  app: FastifyInstance,
  req: FastifyRequest,
): Promise<McpProtectedResourceMetadata> {
  const issuer = await getMcpOAuthIssuer(app, req);
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [...ALL_MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/mcp/health`,
  };
}

export async function getMcpAuthorizationServerMetadata(app: FastifyInstance, req: FastifyRequest) {
  const issuer = await getMcpOAuthIssuer(app, req);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256"],
    client_id_metadata_document_supported: true,
    scopes_supported: [...ALL_MCP_SCOPES],
    resource_documentation: `${issuer}/mcp/health`,
  };
}

export function buildMcpWwwAuthenticateHeader(metadataUrl: string): string {
  return `Bearer realm="vakwen-mcp", resource_metadata="${metadataUrl}"`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
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

function csrfTokenFor(app: FastifyInstance, requestId: string, userId: string): string {
  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  if (!sessionSecret) {
    throw routeError(500, "missing_secret", "SESSION_SECRET is required for MCP OAuth consent CSRF");
  }
  const payload = `${CONSENT_CSRF_VERSION}:${requestId}:${userId}`;
  return `${CONSENT_CSRF_VERSION}.${hmac(sessionSecret, payload)}`;
}

function csrfHash(token: string): string {
  return sha256Base64Url(`mcp-oauth-csrf:${token}`);
}

function assertCsrf(app: FastifyInstance, requestId: string, userId: string, expectedHash: string, received: string): void {
  const expectedToken = csrfTokenFor(app, requestId, userId);
  if (!constantTimeEqual(expectedToken, received) || !constantTimeEqual(csrfHash(received), expectedHash)) {
    throw routeError(403, "mcp_oauth_csrf_invalid", "OAuth consent CSRF token is invalid");
  }
}

function parseScopes(scope: string | undefined): AiConnectorScope[] {
  if (!scope) return [...ALL_MCP_SCOPES];
  const parsed = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parsed.map((item) => scopeSchema.parse(item)))];
}

function normalizeExactRedirectUri(uri: string): string | null {
  const url = new URL(uri);
  if (url.username || url.password || url.search || url.hash || url.pathname === "/" || url.pathname === "") {
    return null;
  }
  return url.toString();
}

type RedirectUriAllowance = "builtin_chatgpt" | "local" | "custom" | "none";

function classifyRedirectUriAllowance(uri: string, customAllowlist: readonly string[] = []): RedirectUriAllowance {
  const url = new URL(uri);
  if (
    url.protocol === "https:"
    && CHATGPT_REDIRECT_HOSTS.has(url.hostname)
    && url.search === ""
    && url.hash === ""
    && (
      url.pathname === "/aip/oauth/callback"
      || /^\/aip\/[^/]+\/oauth\/callback$/.test(url.pathname)
      || /^\/connector\/oauth\/[^/]+$/.test(url.pathname)
    )
  ) {
    return "builtin_chatgpt";
  }
  if (Env.NODE_ENV === "test" || Env.NODE_ENV === "development") {
    if (
      (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return "local";
    }
  }
  const normalized = normalizeExactRedirectUri(uri);
  if (normalized && customAllowlist.includes(normalized)) return "custom";
  return "none";
}

function filterScopesByPolicy(
  scopes: AiConnectorScope[],
  settings: Pick<AiConnectorPolicySettingsDto, "groupToggles">,
): AiConnectorScope[] {
  return scopes.filter((scope) => settings.groupToggles[connectorGroupForScope(scope)]);
}

function oauthRedirect(base: string, params: Record<string, string | undefined | null>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

function sendOAuthError(reply: FastifyReply, statusCode: number, error: string, description: string) {
  return reply.code(statusCode).send({
    error,
    error_description: description,
  });
}

export function setMcpOAuthNoStoreHeaders(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
  reply.header("pragma", "no-cache");
}

function signAccessToken(secret: string, payload: McpOAuthAccessTokenPayload): string {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT", kid: "mcp-oauth-v1" });
  const body = base64UrlJson(payload);
  return `${header}.${body}.${hmac(secret, `${header}.${body}`)}`;
}

export function verifyMcpOAuthAccessToken(
  secret: string,
  token: string,
): McpOAuthAccessTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  const [header, body, signature] = parts as [string, string, string];
  const expected = hmac(secret, `${header}.${body}`);
  if (!constantTimeEqual(expected, signature)) {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  let decodedHeader: { alg?: string; typ?: string };
  let decodedPayload: unknown;
  try {
    decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string; typ?: string };
    decodedPayload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  if (decodedHeader.alg !== "HS256") {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  const payload = accessTokenPayloadSchema.parse(decodedPayload);
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw routeError(401, "mcp_auth_expired", "MCP bearer token has expired");
  }
  return payload;
}

async function issueTokens(input: {
  app: FastifyInstance;
  req: FastifyRequest;
  connectionId: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: AiConnectorScope[];
  refreshExpiresAt: string | null;
  refreshCredentialId?: string;
  predecessorCredentialId?: string | null;
  tokenFamilyId?: string | null;
}) {
  const secret = await getMcpOAuthTokenSecret(input.app);
  const authUser = await input.app.persistence.getAuthUserById(input.userId);
  if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
    throw routeError(401, "mcp_auth_invalid_user", "MCP OAuth user is not active");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessToken = signAccessToken(secret, {
    iss: await getMcpOAuthIssuer(input.app, input.req),
    aud: input.resource,
    resource: input.resource,
    sub: input.userId,
    connectionId: input.connectionId,
    client_id: input.clientId,
    sv: authUser.sessionVersion,
    scope: input.scopes.join(" "),
    iat: nowSeconds,
    exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  });
  const refreshToken = randomToken(48);
  const refreshCredentialId = input.refreshCredentialId ?? randomUUID();
  const familyId = input.tokenFamilyId ?? randomUUID();
  await input.app.persistence.saveAiConnectorCredential({
    id: refreshCredentialId,
    connectionId: input.connectionId,
    credentialType: "oauth_refresh_token",
    tokenHash: hashMcpOAuthToken(secret, refreshToken),
    tokenHint: refreshToken.slice(-8),
    tokenFamilyId: familyId,
    predecessorCredentialId: input.predecessorCredentialId ?? null,
    oauthClientId: input.clientId,
    resource: input.resource,
    scopes: input.scopes,
    sessionVersion: authUser.sessionVersion,
    expiresAt: input.refreshExpiresAt,
  });
  if (input.predecessorCredentialId) {
    await input.app.persistence.revokeAiConnectorCredential(input.predecessorCredentialId, refreshCredentialId);
  }
  return {
    token_type: "Bearer",
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: input.scopes.join(" "),
  };
}

export async function handleMcpOAuthAuthorize(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  setMcpOAuthNoStoreHeaders(reply);
  const rawQuery = req.query as Record<string, string | undefined>;
  const returnTo = `/connectors/chatgpt/authorize?${new URLSearchParams(
    Object.entries(rawQuery).flatMap(([key, value]) => value === undefined ? [] : [[key, value]]),
  ).toString()}`;

  try {
    const { hydrateAuthContext } = await import("../routes/registerRoutes.js");
    await hydrateAuthContext(app, req);
  } catch {
    return reply.redirect(`${app.appBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`, 302);
  }
  if (!req.authContext) {
    return reply.redirect(`${app.appBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`, 302);
  }

  let query: z.infer<typeof authorizeQuerySchema>;
  try {
    query = authorizeQuerySchema.parse(rawQuery);
  } catch {
    return sendOAuthError(reply, 400, "invalid_request", "OAuth authorization request is invalid");
  }

  const settings = await app.persistence.getAiConnectorPolicySettings();
  const redirectUriAllowance = classifyRedirectUriAllowance(query.redirect_uri, settings.oauthRedirectUriAllowlist);
  if (redirectUriAllowance === "none") {
    return sendOAuthError(reply, 400, "invalid_request", "OAuth redirect_uri is not allowed");
  }
  if (redirectUriAllowance === "custom" && !parseUrlClientId(query.client_id)) {
    return sendOAuthError(reply, 400, "invalid_client", "Custom OAuth redirect URIs require URL client metadata");
  }
  try {
    await validateOAuthClient(query.client_id, query.redirect_uri);
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "invalid_client";
    return sendOAuthError(reply, 400, code, error instanceof Error ? error.message : "OAuth client metadata is invalid");
  }
  const resource = await getMcpResourceUrl(app, req);
  if (query.resource !== resource) {
    return sendOAuthError(reply, 400, "invalid_target", "OAuth resource must match the MCP resource URL");
  }

  let scopes: AiConnectorScope[];
  try {
    scopes = parseScopes(query.scope);
  } catch {
    return sendOAuthError(reply, 400, "invalid_scope", "OAuth scope contains an unsupported MCP scope");
  }

  if (!settings.enabled || !settings.allowedProviders.chatgpt) {
    return sendOAuthError(reply, 403, "access_denied", "ChatGPT MCP connectors are disabled");
  }
  const policyScopes = filterScopesByPolicy(scopes, settings);
  if (policyScopes.length === 0) {
    return sendOAuthError(reply, 403, "access_denied", "All requested MCP scope groups are disabled");
  }

  const requestId = randomUUID();
  const csrfToken = csrfTokenFor(app, requestId, req.authContext.sessionUserId);
  await app.persistence.saveMcpOAuthAuthorizationRequest({
    id: requestId,
    userId: req.authContext.sessionUserId,
    clientId: query.client_id,
    redirectUri: query.redirect_uri,
    state: query.state ?? null,
    resource,
    scopes: policyScopes,
    codeChallenge: query.code_challenge,
    codeChallengeMethod: query.code_challenge_method,
    csrfTokenHash: csrfHash(csrfToken),
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
  });

  return reply.redirect(`${app.appBaseUrl}/connectors/chatgpt/authorize?requestId=${encodeURIComponent(requestId)}`, 302);
}

export async function getMcpOAuthConsentRequest(
  app: FastifyInstance,
  req: FastifyRequest,
  requestId: string,
): Promise<McpOAuthConsentRequestDto> {
  if (!req.authContext) throw routeError(401, "auth_required", "authentication required");
  const request = await app.persistence.getMcpOAuthAuthorizationRequest(requestId);
  if (!request || request.userId !== req.authContext.sessionUserId) {
    throw routeError(404, "mcp_oauth_request_not_found", "OAuth consent request not found");
  }
  if (request.approvedAt || request.deniedAt || Date.parse(request.expiresAt) <= Date.now()) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  const settings = await app.persistence.getAiConnectorPolicySettings();
  return {
    requestId: request.id,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    resource: request.resource,
    scopes: [...request.scopes],
    csrfToken: csrfTokenFor(app, request.id, request.userId),
    expiresAt: request.expiresAt,
    policy: {
      maxConnectorLifetimeDays: settings.maxConnectorLifetimeDays,
      groupToggles: { ...settings.groupToggles },
    },
  };
}

export async function approveMcpOAuthConsent(
  app: FastifyInstance,
  req: FastifyRequest,
  requestId: string,
  body: unknown,
): Promise<McpOAuthConsentDecisionDto> {
  if (!req.authContext) throw routeError(401, "auth_required", "authentication required");
  const parsed = approveBodySchema.parse(body);
  const request = await app.persistence.getMcpOAuthAuthorizationRequest(requestId);
  if (!request || request.userId !== req.authContext.sessionUserId) {
    throw routeError(404, "mcp_oauth_request_not_found", "OAuth consent request not found");
  }
  if (request.approvedAt || request.deniedAt || Date.parse(request.expiresAt) <= Date.now()) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  assertCsrf(app, request.id, request.userId, request.csrfTokenHash, parsed.csrfToken);

  const settings = await app.persistence.getAiConnectorPolicySettings();
  const requestedScopeSet = new Set(request.scopes);
  const selectedScopes = parsed.scopes.filter((scope) => requestedScopeSet.has(scope));
  const allowedScopes = filterScopesByPolicy(selectedScopes, settings);
  if (allowedScopes.length === 0) {
    throw routeError(403, "mcp_all_requested_scopes_disabled", "All selected MCP scope groups are disabled");
  }

  const secret = await getMcpOAuthTokenSecret(app);

  const lifetimeDays = Math.min(
    parsed.lifetimeDays ?? Math.min(DEFAULT_REFRESH_TOKEN_TTL_DAYS, settings.maxConnectorLifetimeDays),
    settings.maxConnectorLifetimeDays,
  );
  const expiresAt = new Date(Date.now() + lifetimeDays * 24 * 60 * 60 * 1000).toISOString();
  const connectionId = randomUUID();
  const code = randomToken(32);
  const approval = await app.persistence.approveMcpOAuthAuthorizationRequest({
    requestId: request.id,
    userId: request.userId,
    approvedAt: new Date().toISOString(),
    connection: {
      id: connectionId,
      userId: request.userId,
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "pending",
      oauthClientId: request.clientId,
      oauthSubject: request.userId,
      scopes: allowedScopes,
      expiresAt,
    },
    code: {
      id: randomUUID(),
      codeHash: hashMcpOAuthToken(secret, code),
      connectionId,
      userId: request.userId,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      resource: request.resource,
      scopes: allowedScopes,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      expiresAt: request.expiresAt,
    },
  });
  if (!approval) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }

  return {
    redirectUrl: oauthRedirect(request.redirectUri, {
      code,
      state: request.state,
    }),
  };
}

export async function denyMcpOAuthConsent(
  app: FastifyInstance,
  req: FastifyRequest,
  requestId: string,
  body: unknown,
): Promise<McpOAuthConsentDecisionDto> {
  if (!req.authContext) throw routeError(401, "auth_required", "authentication required");
  const parsed = denyBodySchema.parse(body);
  const request = await app.persistence.getMcpOAuthAuthorizationRequest(requestId);
  if (!request || request.userId !== req.authContext.sessionUserId) {
    throw routeError(404, "mcp_oauth_request_not_found", "OAuth consent request not found");
  }
  if (request.approvedAt || request.deniedAt || Date.parse(request.expiresAt) <= Date.now()) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  assertCsrf(app, request.id, request.userId, request.csrfTokenHash, parsed.csrfToken);
  const denied = await app.persistence.settleMcpOAuthAuthorizationRequest(
    request.id,
    request.userId,
    "denied",
    new Date().toISOString(),
  );
  if (!denied) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  return {
    redirectUrl: oauthRedirect(request.redirectUri, {
      error: "access_denied",
      error_description: "The user denied the Vakwen MCP connector request.",
      state: request.state,
    }),
  };
}

export async function handleMcpOAuthToken(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | Record<string, unknown>> {
  setMcpOAuthNoStoreHeaders(reply);

  let body: z.infer<typeof tokenBodySchema>;
  try {
    body = tokenBodySchema.parse(req.body);
  } catch {
    return sendOAuthError(reply, 400, "invalid_request", "OAuth token request is invalid");
  }

  try {
    await validateOAuthTokenClient(app, req, body);
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "invalid_client";
    return sendOAuthError(reply, 400, code, error instanceof Error ? error.message : "OAuth client authentication failed");
  }

  let secret: string;
  try {
    secret = await getMcpOAuthTokenSecret(app);
  } catch {
    return sendOAuthError(reply, 503, "server_error", "MCP OAuth token secret is not configured");
  }

  if (body.grant_type === "authorization_code") {
    const code = await app.persistence.consumeMcpOAuthAuthorizationCode(hashMcpOAuthToken(secret, body.code));
    if (!code) return sendOAuthError(reply, 400, "invalid_grant", "Authorization code is invalid or expired");
    if (
      code.clientId !== body.client_id
      || code.redirectUri !== body.redirect_uri
      || code.resource !== body.resource
      || sha256Base64Url(body.code_verifier) !== code.codeChallenge
    ) {
      return sendOAuthError(reply, 400, "invalid_grant", "Authorization code verifier or binding is invalid");
    }
    const connection = await app.persistence.getAiConnectorConnection(code.connectionId);
    if (!connection || connection.status !== "pending") {
      return sendOAuthError(reply, 400, "invalid_grant", "Connector authorization is no longer pending");
    }
    const settings = await app.persistence.getAiConnectorPolicySettings();
    const activatedResult = await app.persistence.activateAiConnectorConnectionReplacingProvider({
      connectionId: connection.id,
      userId: code.userId,
      provider: "chatgpt",
      maxActiveConnectionsPerUser: settings.maxActiveConnectionsPerUser,
      oauthClientId: code.clientId,
      oauthSubject: code.userId,
      lastUsedAt: new Date().toISOString(),
      revokedByUserId: code.userId,
      revocationReason: "replaced_by_oauth_authorization",
    });
    if (!activatedResult) {
      return sendOAuthError(reply, 400, "invalid_grant", "Connector authorization is no longer pending");
    }
    const activated = activatedResult.connection;
    for (const revokedConnectionId of activatedResult.revokedConnectionIds) {
      await app.persistence.appendAuditLog({
        actorUserId: code.userId,
        action: "ai_connector_revoked",
        targetUserId: code.userId,
        ipAddress: req.ip,
        metadata: {
          connectionId: revokedConnectionId,
          provider: "chatgpt",
          reason: "replaced_by_oauth_authorization",
        },
      });
    }
    await app.persistence.appendAuditLog({
      actorUserId: code.userId,
      action: "ai_connector_connected",
      targetUserId: code.userId,
      ipAddress: req.ip,
      metadata: {
        connectionId: activated.id,
        provider: activated.provider,
        scopes: activated.scopes,
        expiresAt: activated.expiresAt,
        oauthClientId: code.clientId,
      },
    });
    const tokens = await issueTokens({
      app,
      req,
      connectionId: activated.id,
      userId: code.userId,
      clientId: code.clientId,
      resource: code.resource,
      scopes: activated.scopes,
      refreshExpiresAt: activated.expiresAt,
    });
    return tokens;
  }

  const credential = await app.persistence.getAiConnectorCredentialByHash(
    hashMcpOAuthToken(secret, body.refresh_token),
  );
  if (!credential) return sendOAuthError(reply, 400, "invalid_grant", "Refresh token is invalid");
  const connection = await app.persistence.getAiConnectorConnection(credential.connectionId);
  if (!connection) return sendOAuthError(reply, 400, "invalid_grant", "Connector connection is invalid");
  if (credential.revokedAt || credential.replacedByCredentialId) {
    if (connection.status === "active") {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: null,
        reason: "refresh_token_reuse",
        ipAddress: req.ip,
      });
    }
    return sendOAuthError(reply, 400, "invalid_grant", "Refresh token has already been used");
  }
  if (
    credential.credentialType !== "oauth_refresh_token"
    || credential.oauthClientId !== body.client_id
    || credential.resource !== body.resource
    || (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now())
  ) {
    return sendOAuthError(reply, 400, "invalid_grant", "Refresh token binding is invalid");
  }
  if (connection.status !== "active") {
    return sendOAuthError(reply, 400, "invalid_grant", "Connector connection is not active");
  }
  const authUser = await app.persistence.getAuthUserById(connection.userId);
  if (!authUser || authUser.deactivatedAt || authUser.deletedAt || authUser.sessionVersion !== credential.sessionVersion) {
    await revokeAiConnectorConnection(app, connection.id, {
      revokedByUserId: null,
      reason: "session_version_changed",
      ipAddress: req.ip,
    });
    return sendOAuthError(reply, 400, "invalid_grant", "User session state changed; reconnect the MCP connector");
  }
  const nextCredentialId = randomUUID();
  const consumed = await app.persistence.consumeAiConnectorCredential(credential.id);
  if (!consumed) {
    if (connection.status === "active") {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: null,
        reason: "refresh_token_reuse",
        ipAddress: req.ip,
      });
    }
    return sendOAuthError(reply, 400, "invalid_grant", "Refresh token has already been used");
  }
  return issueTokens({
    app,
    req,
    connectionId: connection.id,
    userId: connection.userId,
    clientId: body.client_id,
    resource: body.resource,
    scopes: credential.scopes.filter((scope) => connection.scopes.includes(scope)),
    refreshExpiresAt: connection.expiresAt,
    refreshCredentialId: nextCredentialId,
    predecessorCredentialId: credential.id,
    tokenFamilyId: credential.tokenFamilyId,
  });
}
