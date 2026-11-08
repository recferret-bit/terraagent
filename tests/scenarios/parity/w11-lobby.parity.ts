import { defineParityCase } from './_define';

/**
 * W11 cross-sector replay parity:
 * - Walks Colony 0's boundary worker (`unitId: 6`) from `sec_0_0` (`(24, -12)`) into `sec_1_0` (`(25, -12)`).
 * - Places a cross-sector `residence` in `sec_1_0` (`(25, -13)`) powered by the `sec_0_0` ↔ `sec_1_0` pylon chain.
 */
export default defineParityCase({
  id: 'w11-lobby',
  scenario: 'w11',
  ticks: 120,
  log: [
    { atTick: 4, kind: 'moveUnit', args: { unitId: 6, q: 25, r: -12 } },
    { atTick: 20, kind: 'enqueueTask', args: { kind: 'build', building: 'solar', q: 26, r: -15 } },
  ],
});
