import { describe, it, expect } from "vitest";
import { targets } from "../../../scripts/env-setup/targets.js";

describe("targets array", () => {
  it("has exactly 4 targets", () => {
    expect(targets).toHaveLength(4);
  });

  it("has exactly these IDs: root:local, docker:dev, docker:local, docker:prod", () => {
    const ids = targets.map((t) => t.id);
    expect(ids).toEqual(["root:local", "docker:dev", "docker:local", "docker:prod"]);
  });

  it("root:local uses rootLocalSchema", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { rootLocalSchema } = await import("../src/env-schema.js") as any;
    const rootTarget = targets.find((t) => t.id === "root:local")!;
    expect(rootTarget.schema).toBe(rootLocalSchema);
  });

  it("root:local uses rootLocalGroups", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { rootLocalGroups } = await import("../src/env-metadata.js") as any;
    const rootTarget = targets.find((t) => t.id === "root:local")!;
    expect(rootTarget.groups).toBe(rootLocalGroups);
  });

  it("docker:dev has footerNotes", () => {
    const target = targets.find((t) => t.id === "docker:dev")!;
    expect(target.footerNotes).toBeDefined();
    expect(Array.isArray(target.footerNotes)).toBe(true);
    expect(target.footerNotes!.length).toBeGreaterThan(0);
  });

  it("docker:prod has footerNotes", () => {
    const target = targets.find((t) => t.id === "docker:prod")!;
    expect(target.footerNotes).toBeDefined();
    expect(Array.isArray(target.footerNotes)).toBe(true);
    expect(target.footerNotes!.length).toBeGreaterThan(0);
  });

  it("docker:local does NOT have footerNotes", () => {
    const target = targets.find((t) => t.id === "docker:local")!;
    expect(target.footerNotes).toBeUndefined();
  });

  it("root:local does NOT have footerNotes", () => {
    const target = targets.find((t) => t.id === "root:local")!;
    expect(target.footerNotes).toBeUndefined();
  });

  it("does NOT include any web:* targets", () => {
    const webTargets = targets.filter((t) => t.id.startsWith("web:"));
    expect(webTargets).toHaveLength(0);
  });

  it("does NOT include root:dev or root:prod targets", () => {
    const ids = targets.map((t) => t.id);
    expect(ids).not.toContain("root:dev");
    expect(ids).not.toContain("root:prod");
  });
});
