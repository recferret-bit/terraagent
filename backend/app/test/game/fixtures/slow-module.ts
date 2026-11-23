import { defineSimModule, defineSystem } from '@terra/sim';

/** Planet ids starting with this prefix are slow: each engine step busy-waits {@link slowStepMs} ms. */
export const SLOW_PLANET_PREFIX = 'pl_slow';

/** Busy-wait per step of a slow planet (`TA_TEST_SLOW_STEP_MS`, default 300 ms: the prod worst case). */
const slowStepMs = Number(process.env.TA_TEST_SLOW_STEP_MS ?? 300);

/**
 * Test/bench-only sim module (scheduler fairness, placement, rebalancing): a system that makes every step of a
 * `pl_slow*` planet cost `TA_TEST_SLOW_STEP_MS` of wall time, standing in for a planet whose systems are slow.
 */
export default defineSimModule({
  id: 'test-slow',
  wave: 'W00',
  systems: [
    defineSystem({
      id: 'test-slow', slot: 14, wave: 'W00',
      run(state) {
        if (!state.meta.planetId.startsWith(SLOW_PLANET_PREFIX)) return;
        const end = performance.now() + slowStepMs;
        while (performance.now() < end) { /* busy-wait: a slow planet step */ }
      },
    }),
  ],
});
