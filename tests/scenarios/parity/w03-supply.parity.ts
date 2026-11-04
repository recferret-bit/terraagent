import { defineParityCase } from './_define';

/**
 * W03 unit supply (owner feedback #2): the W03 colony (Hub, HQ, 2 Harvesters: supply 2 / 10) queues a Harvester batch
 * and a Builder, an unknown unit is rejected; both hosts must end with the same units, queue and `colony.supply`.
 */
export default defineParityCase({
  scenario: 'w03',
  ticks: 400,
  log: [
    { atTick: 1, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'harvester', count: 2 } } },
    { atTick: 2, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'builder' } } },
    { atTick: 3, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'tank' } } },
  ],
});
