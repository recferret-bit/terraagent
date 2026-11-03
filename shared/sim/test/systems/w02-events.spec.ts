import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  step,
  type SimEvent,
} from '../../src';

describe('W02-17 Events: energyCollapse, brownout {group} with debounce, resourceShortage', () => {
  it('hold brownout for 30 s -> single energyCollapse event and debounced brownout {group} event', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    // Hub (+8 / -5) + 1 Extractor (-6) -> rawDemand 11 > supply 8 -> brownout in group 3!
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    const extRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[extRow] = ENTITY_KIND.metalsExtractor;
    state.entities.cols.owner[extRow] = 0;
    state.entities.cols.q[extRow] = 2;
    state.entities.cols.r[extRow] = 0;
    state.entities.cols.footprintW[extRow] = 2;
    state.entities.cols.footprintD[extRow] = 2;
    state.entities.cols.shedGroup[extRow] = 3;
    state.entities.cols.hp[extRow] = 500;
    state.entities.cols.state[extRow] = ENTITY_STATE.active;

    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const allEvents: SimEvent[] = [];

    // Step 29 s (145 ticks) -> brownout event emitted once on tick 1, no energyCollapse yet
    for (let i = 0; i < 29; i++) {
      const r = step(state, [], 5, pipeline);
      allEvents.push(...r.events);
    }
    expect(allEvents.filter((e) => e.kind === 'brownout')).toHaveLength(1);
    expect(allEvents.find((e) => e.kind === 'brownout')?.data).toMatchObject({ group: 3 });
    expect(allEvents.filter((e) => e.kind === 'energyCollapse')).toHaveLength(0);

    // Step 1 more second (total 30 s = 150 ticks) -> single energyCollapse event emitted!
    const r30 = step(state, [], 5, pipeline);
    allEvents.push(...r30.events);
    expect(allEvents.filter((e) => e.kind === 'energyCollapse')).toHaveLength(1);
    expect(allEvents.find((e) => e.kind === 'energyCollapse')?.data).toMatchObject({ durationS: 30 });

    // Hold brownout for another 20 s (100 ticks) -> still only a single energyCollapse event!
    for (let i = 0; i < 20; i++) {
      const r = step(state, [], 5, pipeline);
      allEvents.push(...r.events);
    }
    expect(allEvents.filter((e) => e.kind === 'energyCollapse')).toHaveLength(1);
    expect(allEvents.filter((e) => e.kind === 'brownout')).toHaveLength(1);
  });

  it('emits resourceShortage when stock < 5% of family cap with negative net over 60 s', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 6 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    // Cap is 500, 5% threshold is 25. Start at 24 metals.t1 and drain 0.2/s over 60 s
    creditResource(colony, 'metals.t1', 24, 0);
    (colony as { familyNetPerS?: Record<string, number> }).familyNetPerS = { metals: -0.2 };

    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const events: SimEvent[] = [];

    // Advance 60 s (300 ticks) with negative net -> emits single resourceShortage event for metals
    for (let i = 0; i < 60; i++) {
      colony.stock['metals.t1'] = Math.max(0, colony.stock['metals.t1'] - 0.2);
      const r = step(state, [], 5, pipeline);
      events.push(...r.events);
    }
    const shortages = events.filter((e) => e.kind === 'resourceShortage');
    expect(shortages).toHaveLength(1);
    expect(shortages[0].data).toMatchObject({ family: 'metals', cap: 500 });
  });
});
