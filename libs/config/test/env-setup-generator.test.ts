import { describe, it, expect } from "vitest";
import { generateFileContent } from "../../../scripts/env-setup/generator.js";
import type { TargetConfig, ResolvedValue } from "../../../scripts/env-setup/types.js";
import { z } from "zod";

function makeTarget(overrides: Partial<TargetConfig> = {}): TargetConfig {
  return {
    id: "root:local",
    label: "Test",
    targetPath: ".env.test",
    schema: z.object({ FOO: z.string().default("bar") }),
    groups: [{ label: "Test Group", keys: ["FOO"] }],
    ...overrides,
  } as TargetConfig;
}

function makeValues(entries: [string, string | undefined][]): Map<string, ResolvedValue> {
  const map = new Map<string, ResolvedValue>();
  for (const [key, value] of entries) {
    map.set(key, { key, value, source: "default" });
  }
  return map;
}

describe("generateFileContent footer notes", () => {
  it("appends ## lines for each footerNote", () => {
    const target = makeTarget({
      footerNotes: [
        "Note line 1",
        "Note line 2",
      ],
    });
    const values = makeValues([["FOO", "bar"]]);
    const output = generateFileContent(target, values);

    expect(output).toContain("## Note line 1");
    expect(output).toContain("## Note line 2");
  });

  it("footer notes appear after the last group section", () => {
    const target = makeTarget({
      footerNotes: ["Footer hint"],
    });
    const values = makeValues([["FOO", "bar"]]);
    const output = generateFileContent(target, values);
    const lines = output.split("\n");

    // Find the group header and the footer note
    const groupIdx = lines.findIndex((l) => l === "## Test Group");
    const footerIdx = lines.findIndex((l) => l === "## Footer hint");

    expect(groupIdx).toBeGreaterThanOrEqual(0);
    expect(footerIdx).toBeGreaterThan(groupIdx);
  });

  it("produces no footer section when footerNotes is undefined", () => {
    const target = makeTarget(); // no footerNotes
    const values = makeValues([["FOO", "bar"]]);
    const output = generateFileContent(target, values);
    const lines = output.split("\n");

    // Only group header should be a ## line
    const hashLines = lines.filter((l) => l.startsWith("## "));
    expect(hashLines).toHaveLength(1);
    expect(hashLines[0]).toBe("## Test Group");
  });

  it("produces no footer section when footerNotes is empty array", () => {
    const target = makeTarget({ footerNotes: [] });
    const values = makeValues([["FOO", "bar"]]);
    const output = generateFileContent(target, values);
    const lines = output.split("\n");

    const hashLines = lines.filter((l) => l.startsWith("## "));
    expect(hashLines).toHaveLength(1);
  });

  it("each footer note is prefixed with exactly '## '", () => {
    const target = makeTarget({
      footerNotes: ["Exact prefix check"],
    });
    const values = makeValues([["FOO", "bar"]]);
    const output = generateFileContent(target, values);
    const lines = output.split("\n");
    const footerLine = lines.find((l) => l.includes("Exact prefix check"));
    expect(footerLine).toBe("## Exact prefix check");
  });
});

describe("generateFileContent group output (regression guard)", () => {
  it("emits section header and key=value for grouped keys", () => {
    const target = makeTarget();
    const values = makeValues([["FOO", "bar"]]);
    const output = generateFileContent(target, values);
    expect(output).toContain("## Test Group");
    expect(output).toContain("FOO=bar");
  });

  it("emits commented-out key when value is undefined", () => {
    const target = makeTarget();
    const values = makeValues([["FOO", undefined]]);
    const output = generateFileContent(target, values);
    expect(output).toContain("#FOO=");
  });
});
