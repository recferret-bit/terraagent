import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  addColonyStock,
  buildView,
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyCaps,
  getColonyStock,
  getHqView,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  rowOf,
  setColonyStock,
  SimHost,
  spawnColony,
  spawnColonyLanding,
  type SimCommand,
} from '../../src';

let seq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'system', commandId: `land_${++seq}`, kind, args };
}

function createW01Host(type: 'flat' | 'temperate' = 'temperate', radius = 28): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type, seed: 'landing-test', radius }));
  return host;
}

describe('W01-09: Drop pod landing and HQ deployment', () => {
  it('spawns a colony at tick 0 -> pod descending with 600/350/200/200 stock; after 30 ticks (6.0 s) deploys HQ and emits hqLanded', () => {
    const host = createW01Host('temperate', 56);
    const state = host.state;
    const slots = getSpawnSlots(state);
    expect(slots.length).toBeGreaterThan(0);

    const cmd = mkCmd('system.spawnColony', { colonyId: 'col_0', playerId: 'pl_1', name: 'Ares Base' }, 0);
    spawnColony.handle(state, cmd, {
      dt: 0,
      tick: 0,
      flags: host.pipeline.config.flags,
      data: host.pipeline.config.data,
      events: [],
      rng: (stream) => state.rng[stream],
      newEntityId: () => state.meta.nextEntityId++,
      emit: () => undefined,
    });

    expect(host.tick).toBe(0);
    expect(state.entities.count).toBe(1);
    const cols = state.entities.cols;
    expect(cols.kind[0]).toBe(ENTITY_KIND.pod);
    expect(cols.state[0]).toBe(ENTITY_STATE.descending);
    expect(cols.progress[0]).toBe(0);
    expect(cols.hp[0]).toBe(500);
    expect(cols.hpMax[0]).toBe(500);
    expect(cols.q[0]).toBe(slots[0].q);
    expect(cols.r[0]).toBe(slots[0].r);
    expect(getSpawnSlots(state)[0].claimedBy).toBe(0);
    expect(getHqView(state, 0)).toBeNull();

    const expectedStock = {
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    };
    expect(getColonyStock(state, 0)).toEqual(expectedStock);
    expect(buildView(state).colonies[0].stock).toEqual(expectedStock);

    const hex = hexIndex(state.grid.radius);
    const explored = state.grid.layers.explored as Uint8Array;
    for (let i = 0; i < hex.count; i++) {
      const d = hexDistance(slots[0].q, slots[0].r, hex.q[i], hex.r[i]);
      expect(explored[i] & 1).toBe(d <= 9 ? 1 : 0);
    }

    for (let t = 1; t <= 29; t++) {
      expect(host.step(1).events).toHaveLength(0);
    }
    expect(host.tick).toBe(29);
    expect(cols.state[0]).toBe(ENTITY_STATE.descending);
    expect(cols.progress[0]).toBeCloseTo(29 / 30, 5);
    expect(state.entities.count).toBe(1);

    const step30 = host.step(1);
    expect(host.tick).toBe(30);
    expect(cols.state[0]).toBe(ENTITY_STATE.idle);
    expect(cols.progress[0]).toBe(1);
    expect(state.entities.count).toBe(2);

    const hqRow = 1;
    expect(cols.kind[hqRow]).toBe(ENTITY_KIND.hq);
    expect(cols.owner[hqRow]).toBe(0);
    expect(cols.q[hqRow]).toBe(slots[0].q);
    expect(cols.r[hqRow]).toBe(slots[0].r);
    expect(cols.hp[hqRow]).toBe(900);
    expect(cols.cell[hqRow]).toBe(800);

    expect(step30.events).toHaveLength(1);
    const ev = step30.events[0];
    expect(ev.kind).toBe('hqLanded');
    expect(ev.atTick).toBe(30);
    expect(ev.data).toEqual({
      colonyId: 'col_0',
      entityId: cols.id[hqRow],
      podEntityId: cols.id[0],
      q: slots[0].q,
      r: slots[0].r,
    });
    expect(eventDef('hqLanded').data.safeParse(ev.data).success).toBe(true);
  });
});

describe('W01-09: dev.land and colony stock helpers', () => {
  it('deploys the HQ immediately on the next step when dev.land is submitted', () => {
    const host = createW01Host('flat', 28);
    const state = host.state;
    const { podEntityId } = spawnColonyLanding(state, { colonyId: 0, q: 3, r: -2 });
    const podRow = rowOf(state.entities, podEntityId);
    expect(state.entities.cols.state[podRow]).toBe(ENTITY_STATE.descending);
    expect(state.entities.count).toBe(1);

    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'dev_land_1', kind: 'dev.land', args: {} });
    const res = host.step(1);
    expect(res.outcomes[0]?.code).toBeUndefined();
    expect(state.entities.cols.state[podRow]).toBe(ENTITY_STATE.idle);
    expect(state.entities.cols.progress[podRow]).toBe(1);
    expect(state.entities.count).toBe(2);

    const hq = getHqView(state, 0);
    expect(hq).not.toBeNull();
    expect(hq?.q).toBe(3);
    expect(hq?.r).toBe(-2);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].kind).toBe('hqLanded');
  });

  it('supports getColonyStock, setColonyStock, addColonyStock, and getColonyCaps', () => {
    const host = createW01Host('flat', 16);
    const state = host.state;
    spawnColonyLanding(state, { colonyId: 0, q: 0, r: 0 });

    expect(getColonyCaps(state, 0)).toEqual({
      metals: 600,
      minerals: 500,
      energy: 0,
      bio: 500,
      item: 0,
    });

    addColonyStock(state, 0, { 'metals.t1': -200, 'minerals.t1': 100 }, true);
    expect(getColonyStock(state, 0)).toEqual({
      'metals.t1': 400,
      'minerals.t1': 450,
      'bio.biomass': 200,
      'bio.water': 200,
    });

    addColonyStock(state, 0, { 'minerals.t1': 200 }, true);
    expect(getColonyStock(state, 0)['minerals.t1']).toBe(500);

    setColonyStock(state, 0, { 'metals.t1': 120, 'minerals.t1': 80, 'bio.biomass': 50, 'bio.water': 50 });
    expect(buildView(state).colonies[0].stock).toEqual({
      'metals.t1': 120,
      'minerals.t1': 80,
      'bio.biomass': 50,
      'bio.water': 50,
    });
  });
});
