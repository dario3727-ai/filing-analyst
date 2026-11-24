import type { Clock } from "@/lib/sec/rate-limiter";

/**
 * A pretend clock for tests: sleep() returns immediately but moves time
 * forward by the requested amount, so code that waits seconds runs in
 * microseconds. `sleeps` records every wait so tests can check them.
 */
export function createFakeClock(start = 0): Clock & { sleeps: number[] } {
  let time = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
  };
}
