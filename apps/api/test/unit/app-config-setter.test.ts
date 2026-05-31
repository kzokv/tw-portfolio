import { beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";

describe("MemoryPersistence.setRepairCooldownMinutes (KZO-142)", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  it("setting a positive integer updates repairCooldownMinutes and advances updatedAt", async () => {
    const before = await persistence.getAppConfig();
    const beforeMs = Date.parse(before.updatedAt);

    await persistence.setRepairCooldownMinutes(60);

    const after = await persistence.getAppConfig();
    expect(after.repairCooldownMinutes).toBe(60);
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(beforeMs);
  });

  it("setting null leaves repairCooldownMinutes=null and advances updatedAt", async () => {
    await persistence.setRepairCooldownMinutes(120);
    const seeded = await persistence.getAppConfig();
    const seededMs = Date.parse(seeded.updatedAt);

    await persistence.setRepairCooldownMinutes(null);

    const after = await persistence.getAppConfig();
    expect(after.repairCooldownMinutes).toBeNull();
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(seededMs);
  });

  it("two consecutive same-value sets still produce strictly monotonic updatedAt", async () => {
    await persistence.setRepairCooldownMinutes(30);
    const first = await persistence.getAppConfig();

    await persistence.setRepairCooldownMinutes(30);
    const second = await persistence.getAppConfig();

    expect(second.repairCooldownMinutes).toBe(30);
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
  });

  it("getAppConfig returns the current repairCooldownMinutes and a non-empty updatedAt", async () => {
    const initial = await persistence.getAppConfig();
    expect(initial.repairCooldownMinutes).toBeNull();
    expect(typeof initial.updatedAt).toBe("string");
    expect(initial.updatedAt.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(initial.updatedAt))).toBe(true);

    await persistence.setRepairCooldownMinutes(45);
    const updated = await persistence.getAppConfig();
    expect(updated.repairCooldownMinutes).toBe(45);
    expect(typeof updated.updatedAt).toBe("string");
    expect(updated.updatedAt.length).toBeGreaterThan(0);
  });
});
