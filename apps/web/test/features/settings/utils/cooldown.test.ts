import { describe, expect, it } from "vitest";
import { getCooldownRemainingMinutes } from "../../../../features/settings/utils/cooldown.js";

describe("getCooldownRemainingMinutes", () => {
  // Use a fixed reference point so all assertions are deterministic
  const now = new Date("2026-04-15T12:00:00.000Z");

  it("returns 0 when repairAvailableAt is null", () => {
    expect(getCooldownRemainingMinutes(null, now)).toBe(0);
  });

  it("returns 0 when repairAvailableAt is undefined", () => {
    expect(getCooldownRemainingMinutes(undefined, now)).toBe(0);
  });

  it("returns 0 when repairAvailableAt is an unparseable string", () => {
    expect(getCooldownRemainingMinutes("not-a-date", now)).toBe(0);
  });

  it("returns 0 when repairAvailableAt is in the past", () => {
    // 10 minutes before now → cooldown already expired
    const past = new Date(now.getTime() - 10 * 60_000).toISOString();
    expect(getCooldownRemainingMinutes(past, now)).toBe(0);
  });

  it("returns correct minute count when repairAvailableAt is 30 minutes ahead", () => {
    const thirtyMinutesAhead = new Date(now.getTime() + 30 * 60_000).toISOString();
    expect(getCooldownRemainingMinutes(thirtyMinutesAhead, now)).toBe(30);
  });

  it("returns 1 when repairAvailableAt is 30 seconds ahead (ceiling behavior)", () => {
    // 30 seconds = 0.5 min → Math.ceil(0.5) = 1, Math.max(1, 1) = 1
    const thirtySecondsAhead = new Date(now.getTime() + 30_000).toISOString();
    expect(getCooldownRemainingMinutes(thirtySecondsAhead, now)).toBe(1);
  });

  it("returns 1 at the exact 1 ms boundary (minimum positive remaining)", () => {
    // 1ms = 0.0000167 min → Math.ceil → 1, Math.max(1, 1) = 1
    const oneMillisecondAhead = new Date(now.getTime() + 1).toISOString();
    expect(getCooldownRemainingMinutes(oneMillisecondAhead, now)).toBe(1);
  });

  it("honors injected now — deterministic regardless of wall clock", () => {
    const fixedNow = new Date("2026-01-15T08:00:00.000Z");
    const repairAvailableAt = "2026-01-15T08:45:00.000Z"; // 45 min ahead
    expect(getCooldownRemainingMinutes(repairAvailableAt, fixedNow)).toBe(45);
  });
});
