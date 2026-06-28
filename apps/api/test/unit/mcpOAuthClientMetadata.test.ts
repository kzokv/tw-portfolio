import { Buffer } from "node:buffer";
import type { LookupAddress } from "node:dns";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPinnedClientMetadataLookup,
  setMcpOAuthClientMetadataNetworkForTest,
} from "../../src/mcp/oauth.js";
import { inspectOAuthClient } from "../../src/mcp/oauthClientAuth.js";
import { isOpenAiAppsMcpCorsOrigin } from "../../src/mcp/openAiAppsAdapter.js";

let resetNetwork: (() => void) | null = null;

afterEach(() => {
  resetNetwork?.();
  resetNetwork = null;
});

describe("MCP OAuth client metadata lookup", () => {
  it("returns a single pinned address for default Node HTTPS lookups", async () => {
    const lookup = createPinnedClientMetadataLookup({ address: "203.0.113.10", family: 4 });

    const result = await new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) => {
      lookup("chatgpt.com", {}, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ address, family });
      });
    });

    expect(result).toEqual({ address: "203.0.113.10", family: 4 });
  });

  it("returns a pinned address array when Node HTTPS requests all lookup records", async () => {
    const lookup = createPinnedClientMetadataLookup({ address: "2001:db8::10", family: 6 });

    const result = await new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) => {
      lookup("chatgpt.com", { all: true }, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ address, family });
      });
    });

    expect(result).toEqual({
      address: [{ address: "2001:db8::10", family: 6 }],
      family: undefined,
    });
  });

  it("detects Claude.ai metadata as a dedicated OAuth client kind", async () => {
    const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    resetNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async () => {
        const body = JSON.stringify({
          client_id: clientId,
          client_name: "Claude.ai",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        });
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(body, "utf8"),
          body,
        };
      },
    });

    await expect(inspectOAuthClient(clientId, redirectUri)).resolves.toMatchObject({
      identity: {
        vendor: "anthropic",
        clientKind: "claude_ai_connector",
        label: "Claude.ai",
      },
    });
  });

  it("allows Claude.ai browser-origin MCP CORS requests", () => {
    expect(isOpenAiAppsMcpCorsOrigin("https://claude.ai")).toBe(true);
    expect(isOpenAiAppsMcpCorsOrigin("https://claude.ai/some/path")).toBe(true);
  });
});
