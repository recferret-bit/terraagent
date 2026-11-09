import { defineParityCase } from './_define';

/**
 * W11 isolated single-sector (R=48, 7,057 tiles) replay parity:
 * - Moves Colony 0's worker (`unitId: 6`) inside `sec_0_0` from `(24, -12)` to `(25, -12)`.
 * - Enqueues a `solar` build task inside `sec_0_0` at `(26, -15)` powered by Colony 0's `sec_0_0` pylon network.
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
