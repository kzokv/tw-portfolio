import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "../../src/services/canonicalJson.js";

describe("canonicalJsonStringify", () => {
  it("treats recursively reordered object keys as equal", () => {
    const before = { counts: { trades: 1, dividends: 2 }, rows: [{ id: "a", detail: { x: 1, y: 2 } }] };
    const after = { rows: [{ detail: { y: 2, x: 1 }, id: "a" }], counts: { dividends: 2, trades: 1 } };

    expect(canonicalJsonStringify(before)).toBe(canonicalJsonStringify(after));
  });

  it("preserves array order and genuine value differences", () => {
    expect(canonicalJsonStringify({ rows: ["a", "b"] })).not.toBe(
      canonicalJsonStringify({ rows: ["b", "a"] }),
    );
    expect(canonicalJsonStringify({ count: 1 })).not.toBe(canonicalJsonStringify({ count: 2 }));
  });
});
