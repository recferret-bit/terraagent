import { defineParityCase } from './_define';

/**
 * W03 unit supply (owner feedback #2): the W03 colony (Hub, HQ, 2 workers: supply 2 / 10) queues a T1 worker batch
 * and a T2 worker; an unknown unit is rejected; both hosts must end with the same units, queue and `colony.supply`.
 */
export default defineParityCase({
  scenario: 'w03',
  ticks: 400,
  log: [
    { atTick: 1, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'worker', tier: 1, count: 2 } } },
    { atTick: 2, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'worker', tier: 2 } } },
    { atTick: 3, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'tank' } } },
  ],
});
