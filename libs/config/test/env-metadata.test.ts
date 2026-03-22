import { describe, it, expect } from "vitest";
import * as metadata from "../src/env-metadata.js";
import { envGroups } from "../src/env-metadata.js";

describe("rootLocalGroups", () => {
  async function importRootLocalGroups() {
    const mod = await import("../src/env-metadata.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod as any).rootLocalGroups;
  }

  it("is exported from env-metadata", async () => {
    const rootLocalGroups = await importRootLocalGroups();
    expect(rootLocalGroups).toBeDefined();
    expect(Array.isArray(rootLocalGroups)).toBe(true);
  });

  it("includes all envGroups labels", async () => {
    const rootLocalGroups = await importRootLocalGroups();
    const envLabels = envGroups.map((g) => g.label);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootLocalLabels = rootLocalGroups.map((g: any) => g.label);
    for (const label of envLabels) {
      expect(rootLocalLabels).toContain(label);
    }
  });

  it("includes 'Web app (Next.js)' group", async () => {
    const rootLocalGroups = await importRootLocalGroups();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = rootLocalGroups.map((g: any) => g.label);
    expect(labels).toContain("Web app (Next.js)");
  });

  it("last group has NEXT_PUBLIC_* keys", async () => {
    const rootLocalGroups = await importRootLocalGroups();
    const lastGroup = rootLocalGroups[rootLocalGroups.length - 1];
    expect(lastGroup.keys).toEqual(["NEXT_PUBLIC_AUTH_MODE", "NEXT_PUBLIC_API_BASE_URL"]);
  });

  it("has exactly envGroups.length + 1 groups", async () => {
    const rootLocalGroups = await importRootLocalGroups();
    expect(rootLocalGroups).toHaveLength(envGroups.length + 1);
  });
});

describe("webEnvGroups removal", () => {
  it("webEnvGroups is NOT exported from env-metadata", () => {
    expect((metadata as Record<string, unknown>).webEnvGroups).toBeUndefined();
  });
});

describe("existing exports unchanged", () => {
  it("envGroups is still exported with expected structure", () => {
    expect(envGroups.length).toBeGreaterThanOrEqual(6);
    expect(envGroups[0].label).toBe("Environment & modes");
  });

  it("dockerCloudGroups is still exported", () => {
    expect(metadata.dockerCloudGroups).toBeDefined();
    expect(Array.isArray(metadata.dockerCloudGroups)).toBe(true);
  });

  it("dockerLocalGroups is still exported", () => {
    expect(metadata.dockerLocalGroups).toBeDefined();
    expect(Array.isArray(metadata.dockerLocalGroups)).toBe(true);
  });
});
