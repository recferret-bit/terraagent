import { defineParityCase } from './_define';

/** W00: the empty flat planet (scenario entity id 1) plus three spawned test entities, nudged and teleported for 600 ticks, no warp. */
export default defineParityCase({
  scenario: 'w00',
  ticks: 600,
  log: [
    { atTick: 0, kind: 'dev.ping', args: { note: 'start' } },
    { atTick: 5, kind: 'dev.spawn', args: { q: 3, r: -2 } },
    { atTick: 5, kind: 'dev.spawn', args: { q: -4, r: 6 } },
    { atTick: 20, kind: 'dev.spawn', args: { q: 10, r: 10 } },
    { atTick: 30, kind: 'dev.nudge', args: { id: 2, dq: 1 } },
    { atTick: 31, kind: 'dev.nudge', args: { id: 2, dq: 1, dr: 1 } },
    { atTick: 31, kind: 'dev.nudge', args: { id: 1 } },
    { atTick: 100, kind: 'dev.teleport', args: { id: 3, q: -20, r: 15 } },
    { atTick: 150, kind: 'dev.ping', args: {} },
    { atTick: 200, kind: 'dev.nudge', args: { id: 4, dr: -1 } },
    { atTick: 250, kind: 'dev.nudge', args: { id: 3, dq: -1, dr: 2 } },
    { atTick: 250, kind: 'dev.nudge', args: { id: 99 } },
    { atTick: 300, kind: 'dev.teleport', args: { id: 1, q: 7, r: -7 } },
    { atTick: 450, kind: 'dev.nudge', args: { id: 4, dq: 2 } },
    { atTick: 599, kind: 'dev.ping', args: { note: 'end' } },
  ],
});
