import { afterEach, describe, expect, it, vi } from "vitest";
import { MinRequestIntervalPacer } from "../../../src/services/market-data/minRequestIntervalPacer.js";

describe("MinRequestIntervalPacer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes concurrent callers at the configured interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T00:00:00.000Z"));
    const pacer = new MinRequestIntervalPacer(1_000);
    const releaseTimes: number[] = [];

    await pacer.waitTurn().then(() => releaseTimes.push(Date.now()));
    const second = pacer.waitTurn().then(() => releaseTimes.push(Date.now()));
    const third = pacer.waitTurn().then(() => releaseTimes.push(Date.now()));

    await Promise.resolve();
    expect(releaseTimes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(releaseTimes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(releaseTimes).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(releaseTimes).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([second, third]);
    expect(releaseTimes).toEqual([
      new Date("2026-06-23T00:00:00.000Z").getTime(),
      new Date("2026-06-23T00:00:01.000Z").getTime(),
      new Date("2026-06-23T00:00:02.000Z").getTime(),
    ]);
  });

  it("uses the latest dynamic interval and lets zero disable spacing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T00:00:00.000Z"));
    let interval = 500;
    const pacer = new MinRequestIntervalPacer(() => interval);
    const releaseTimes: number[] = [];

    await pacer.waitTurn().then(() => releaseTimes.push(Date.now()));
    interval = 0;
    await pacer.waitTurn().then(() => releaseTimes.push(Date.now()));

    expect(releaseTimes).toEqual([
      new Date("2026-06-23T00:00:00.000Z").getTime(),
      new Date("2026-06-23T00:00:00.000Z").getTime(),
    ]);
  });
});
