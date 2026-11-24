import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/sec/rate-limiter";
import { createFakeClock } from "../../../tests/fake-clock";

describe("createRateLimiter", () => {
  it("lets the first request start immediately", async () => {
    const clock = createFakeClock();
    const waitTurn = createRateLimiter(8, clock);
    await waitTurn();
    expect(clock.now()).toBe(0);
    expect(clock.sleeps).toEqual([]);
  });

  it("spaces back-to-back requests 125 ms apart at 8 per second", async () => {
    const clock = createFakeClock();
    const waitTurn = createRateLimiter(8, clock);
    const starts: number[] = [];
    for (let i = 0; i < 10; i++) {
      await waitTurn();
      starts.push(clock.now());
    }
    expect(starts).toEqual([0, 125, 250, 375, 500, 625, 750, 875, 1000, 1125]);
  });

  it("never starts more than 8 requests in any one-second window", async () => {
    const clock = createFakeClock();
    const waitTurn = createRateLimiter(8, clock);
    const starts: number[] = [];
    for (let i = 0; i < 40; i++) {
      await waitTurn();
      starts.push(clock.now());
    }
    for (const t of starts) {
      const inWindow = starts.filter((s) => s >= t && s < t + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(8);
    }
  });

  it("gives requests fired at the same moment separate slots", async () => {
    const clock = createFakeClock();
    const waitTurn = createRateLimiter(8, clock);
    // Fire 9 at once, like Promise.all over a list of URLs.
    await Promise.all(Array.from({ length: 9 }, () => waitTurn()));
    // The 9th can't start before 1000 ms (8 slots of 125 ms before it).
    expect(clock.now()).toBe(1000);
    expect(clock.sleeps).toHaveLength(8);
  });

  it("doesn't make you wait if enough time has already passed", async () => {
    const clock = createFakeClock();
    const waitTurn = createRateLimiter(8, clock);
    await waitTurn();
    await clock.sleep(5000); // e.g. slow parsing between requests
    const sleepsBefore = clock.sleeps.length;
    await waitTurn();
    expect(clock.sleeps.length).toBe(sleepsBefore);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects maxPerSecond = %s", (bad) => {
    expect(() => createRateLimiter(bad)).toThrow(/positive number/);
  });
});
