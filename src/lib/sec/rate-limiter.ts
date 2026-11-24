/**
 * Spaces out requests so no more than `maxPerSecond` start in any one second.
 *
 * How it works: every call reserves the next free time slot, then waits until
 * that slot. With 8 per second the slots are 125 ms apart, so even if many
 * requests are fired at once, they start at 0, 125, 250, ... ms.
 */

/** Time source. Real code uses the system clock; tests pass a fake one. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Call `await waitTurn()` right before each request. */
export type WaitTurn = () => Promise<void>;

export function createRateLimiter(maxPerSecond: number, clock: Clock = systemClock): WaitTurn {
  if (!Number.isFinite(maxPerSecond) || maxPerSecond <= 0) {
    throw new Error(`maxPerSecond must be a positive number, got ${maxPerSecond}`);
  }
  const intervalMs = 1000 / maxPerSecond;
  let nextFreeSlot = 0; // earliest time (ms) the next request may start

  return async function waitTurn(): Promise<void> {
    const now = clock.now();
    const start = Math.max(now, nextFreeSlot);
    // Reserve the slot before waiting, so calls made at the same moment
    // each get their own slot instead of all starting together.
    nextFreeSlot = start + intervalMs;
    if (start > now) await clock.sleep(start - now);
  };
}
