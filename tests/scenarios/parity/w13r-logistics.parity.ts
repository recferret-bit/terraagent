import { defineParityCase } from './_define';

/**
 * W13-57 shared-rule parity: the W13 regions/logistics story world (desert planet pinned to its region at creation, three
 * colonies, Dune Works with an army on a Hub-only supply network) queues two Builders and runs two supply windows. Both hosts
 * must end with the same region pin, logistics windows, supply postings and snapshot.
 */
export default defineParityCase({
  scenario: 'w13r',
  ticks: 650,
  log: [
    { atTick: 1, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'worker', count: 2 } } },
  ],
});
