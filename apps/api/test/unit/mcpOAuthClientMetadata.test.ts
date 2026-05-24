import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import { createPinnedClientMetadataLookup } from "../../src/mcp/oauth.js";

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
});
