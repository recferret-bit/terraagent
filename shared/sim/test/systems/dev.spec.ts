import { describe, expect, it } from 'vitest';
import {
  createPlanet,
  enqueueTerraformOrder,
  getColonyTerraformOrders,
  getConstructionOrders,
  hexIndex,
  markTileExplored,
  rowOf,
  setTileOwner,
  SimHost,
  type SimCommand,
} from '../../src';
import { ensureColonyRecord } from '../../src/kernel/colonies';
import { DEV_ENTITY_KIND } from '../../src/systems/dev';
import { spawnHqUnit, stepTerraformWorkWithCell } from '../../src/systems/hq';
import { getColonyStock } from '../../src/economy';
import { w01Host as sharedW01Host } from '../helpers/host';

let n = 0;
const cmd = (kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand => ({
  colonyIndex,
  source: 'dev',
  commandId: `d${++n}`,
  kind,
  args,
});

function host(flags: string[] = ['W00']): SimHost {
  const h = new SimHost({ flags });
  h.load(createPlanet({ type: 'flat', seed: 'dev', radius: 6 }));
  return h;
}

function w01Host(): SimHost {
  const h = sharedW01Host({ type: 'temperate', seed: 'w01-dev', radius: 10 });
  ensureColonyRecord(h.state, 0, 0);
  return h;
}

const run = (h: SimHost, c: SimCommand) => h.step(1).outcomes.find((o) => o.commandId === c.commandId)!;
const send = (h: SimHost, c: SimCommand) => { h.submit(c); return run(h, c); };

describe('dev commands (W00)', () => {
  it('ping changes no state and emits dev.pong with the note', () => {
    const h = host();
    const before = h.state.entities.count;
    const c = cmd('dev.ping', { note: 'hi' }, null);
    h.submit(c);
    const res = h.step(1);
    expect(res.outcomes[0]).toMatchObject({ commandId: c.commandId, appliedAtTick: h.tick });
    expect(res.outcomes[0].code).toBeUndefined();
    expect(res.events).toMatchObject([{ kind: 'dev.pong', data: { note: 'hi' } }]);
    expect(h.state.entities.count).toBe(before);
  });

  it('spawn inserts kind 1 at the tile centre; nudge moves by the data row; teleport sets', () => {
    const h = host();
    expect(send(h, cmd('dev.spawn', { q: 2, r: -1 }, null)).code).toBeUndefined();
    const e = h.state.entities;
    const id = e.cols.id[0];
    expect([e.cols.kind[0], e.cols.x[0], e.cols.y[0], e.cols.q[0], e.cols.r[0]]).toEqual([DEV_ENTITY_KIND, 2, -1, 2, -1]);
    const tick = h.tick;
    expect(send(h, cmd('dev.nudge', { id }, null))).toMatchObject({ appliedAtTick: tick + 1 });
    expect([e.cols.x[0], e.cols.y[0], e.cols.changedAt[0]]).toEqual([3, -1, tick + 1]);
    send(h, cmd('dev.nudge', { id, dr: 1 }, null));
    expect([e.cols.x[0], e.cols.y[0]]).toEqual([3, 0]);
    send(h, cmd('dev.teleport', { id, q: -4, r: 5 }, null));
    expect([e.cols.x[0], e.cols.y[0], e.cols.q[0], e.cols.r[0]]).toEqual([-4, 5, -4, 5]);
  });

  it('rejects unknown entities', () => {
    const h = host();
    expect(send(h, cmd('dev.nudge', { id: 99 }, null)).code).toBe('unknown_entity');
    expect(send(h, cmd('dev.teleport', { id: 99, q: 0, r: 0 }, null)).code).toBe('unknown_entity');
  });

  it('nudge is visible in a diff', () => {
    const h = host();
    send(h, cmd('dev.spawn', { q: 0, r: 0 }, null));
    const from = h.tick;
    send(h, cmd('dev.nudge', { id: h.state.entities.cols.id[0] }, null));
    const replica = h.clone();
    expect(h.diffSince(from).byteLength).toBeGreaterThan(0);
    expect(replica.state.entities.cols.x[0]).toBe(1);
  });
});

describe('dev commands acceptance: cell 0 trickle rate', () => {
  it('Acceptance check: dev.cell 0 empties HQ cell and slows Grade to 3 E/s trickle rate', () => {
    const h = w01Host();
    const state = h.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const slot = rowOf(state.entities, hqId);

    // 1. Full cell: Grade takes 10 ticks (2.0s)
    let fullProgress = 0;
    let fullTicks = 0;
    while (fullProgress < 1 - 1e-6 && fullTicks < 100) {
      h.step(1);
      const stepRes = stepTerraformWorkWithCell(state, slot, { baseTimeS: 3, totalEnergyE: 20 });
      fullProgress += stepRes.progressDelta;
      fullTicks++;
    }
    expect(fullTicks).toBe(10);
    expect(fullProgress).toBeCloseTo(1.0, 5);

    // 2. Dev console: `cell 0`
    h.submit(cmd('dev.cell', { energy: 0 }));
    h.step(1);
    // dev.cell 0 set cell to 0; hq slot recharged by 0.6 E in this tick, and stepTerraformWorkWithCell draws that 0.6 E
    const firstStep = stepTerraformWorkWithCell(state, slot, { baseTimeS: 3, totalEnergyE: 20 });
    expect(state.entities.cols.cell[slot]).toBe(0);
    expect(firstStep.energyDrawnE).toBeCloseTo(0.6, 5);
    expect(firstStep.progressDelta).toBeCloseTo(0.03, 5);

    // 3. Drained cell: Grade slows from 10 ticks (2.0s) to 34 ticks (~6.7-6.8s) total
    let trickleProgress = firstStep.progressDelta;
    let trickleTicks = 1;
    while (trickleProgress < 1 - 1e-6 && trickleTicks < 100) {
      h.step(1);
      const stepRes = stepTerraformWorkWithCell(state, slot, { baseTimeS: 3, totalEnergyE: 20 });
      expect(stepRes.energyDrawnE).toBeCloseTo(0.6, 5);
      expect(stepRes.progressDelta).toBeCloseTo(0.03, 5);
      expect(state.entities.cols.cell[slot]).toBe(0);
      trickleProgress += stepRes.progressDelta;
      trickleTicks++;
    }
    expect(trickleTicks).toBe(34);
    expect(trickleProgress).toBeGreaterThanOrEqual(1.0);
    expect(trickleTicks * 0.2).toBeCloseTo(6.8, 5);
  });
});

describe('dev commands (W01)', () => {
  it('W01 commands reject with wave_disabled when W01 flag is absent', () => {
    const h = host(['W00']);
    expect(send(h, cmd('dev.cell', { energy: 0 })).code).toBe('wave_disabled');
    expect(send(h, cmd('dev.grant', { resource: 'metals.t1', amount: 500 })).code).toBe('wave_disabled');
    expect(send(h, cmd('dev.reveal', {})).code).toBe('wave_disabled');
    expect(send(h, cmd('dev.seed', { seed: 's' })).code).toBe('wave_disabled');
  });

  it('dev.grant adds stock by full resource key; shorthands are the console\'s job (the contract takes a ResourceKey)', () => {
    const h = w01Host();
    send(h, cmd('dev.grant', { resource: 'metals.t1', amount: 500 }));
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(500);
    send(h, cmd('dev.grant', { resource: 'bio.water', amount: 75 }));
    expect(getColonyStock(h.state, 0)['bio.water']).toBe(75);
    expect(send(h, cmd('dev.grant', { resource: 'metals', amount: 250 })).code).toBe('invalid_args');
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(500);
  });

});

describe('dev commands (W01): colony scope, owner checks, seed', () => {
  it('GP-18: colony-scoped dev commands without a colony are refused not_own_colony', () => {
    const h = w01Host();
    for (const c of [cmd('dev.grant', { resource: 'metals.t1', amount: 5 }, null), cmd('dev.cell', { energy: 0 }, null), cmd('dev.reveal', {}, null), cmd('dev.land', {}, null)]) {
      expect(send(h, c).code).toBe('not_own_colony');
    }
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(0);
  });

  it('GP-27: tp / cell never fall back to another colony\'s HQ; teleport by id refuses another colony\'s unit', () => {
    const h = w01Host();
    const other = spawnHqUnit(h.state, { owner: 1, q: 2, r: 0 });
    const row = rowOf(h.state.entities, other);
    expect(send(h, cmd('dev.cell', { energy: 0 })).code).toBe('unknown_entity');
    expect(send(h, cmd('dev.teleport', { q: 4, r: -3 })).code).toBe('unknown_entity');
    expect(send(h, cmd('dev.teleport', { id: other, q: 4, r: -3 })).code).toBe('not_own_colony');
    expect(h.state.entities.cols.cell[row]).toBe(800);
    expect([h.state.entities.cols.q[row], h.state.entities.cols.r[row]]).toEqual([2, 0]);
  });

  it('dev.grant withdraws a negative amount clamped to the balance and rejects fractions or unknown keys', () => {
    const h = w01Host();
    send(h, cmd('dev.grant', { resource: 'metals.t1', amount: 100 }));
    expect(send(h, cmd('dev.grant', { resource: 'metals.t1', amount: -30 })).code).toBeUndefined();
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(70);
    expect(send(h, cmd('dev.grant', { resource: 'metals.t1', amount: -500 })).code).toBeUndefined();
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(0);
    expect(send(h, cmd('dev.grant', { resource: 'metals.t1', amount: 2.5 })).code).toBe('invalid_args');
    expect(send(h, cmd('dev.grant', { resource: 'unobtainium', amount: 5 })).code).toBe('invalid_args');
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(0);
  });

  it('dev.grant rejects a colony that does not exist and creates no colony record', () => {
    const h = w01Host();
    expect(send(h, cmd('dev.grant', { resource: 'metals.t1', amount: 10 }, 5)).code).toBe('invalid_args');
    expect(h.state.colonies).toHaveLength(1);
    expect(send(h, cmd('dev.grant', { resource: 'metals.t1', amount: 10 }, 0)).code).toBeUndefined();
  });

  it('dev.reveal marks all tiles explored for colony', () => {
    const h = w01Host();
    const outcome = send(h, cmd('dev.reveal', {}));
    expect(outcome.code).toBeUndefined();

    const explored = h.state.grid.layers.explored as Uint8Array;
    const mask = 1 << 0;
    for (let i = 0; i < h.state.grid.count; i++) {
      expect((explored[i] & mask) !== 0).toBe(true);
    }
  });

});

describe('dev commands (W01): seed, teleport, land', () => {
  it('dev.seed regenerates planet terrain with new seed', () => {
    const h = w01Host();
    expect(h.state.meta.seed).toBe('w01-dev');

    const outcome = send(h, cmd('dev.seed', { seed: 'new-seed-123' }));
    expect(outcome.code).toBeUndefined();
    expect(h.state.meta.seed).toBe('new-seed-123');
  });

  it('GP-27 / GP-33: dev.seed drops every order and resets territory, anchors and fog to the new ground (HQ vision again)', () => {
    const h = w01Host();
    const hqId = spawnHqUnit(h.state, { owner: 0, q: 0, r: 0 });
    const layers = h.state.grid.layers;
    const far = hexIndex(h.state.grid.radius).indexOf(10, 0); // outside the HQ's vision (9)
    expect(enqueueTerraformOrder(h.state, { colonyId: 0, op: 'auto', tiles: [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }] }).ok).toBe(true);
    setTileOwner(h.state.grid, far, 0);
    (layers.anchors as Uint8Array)[far] = 2;
    markTileExplored(h.state.grid, far, 0);
    expect(getColonyTerraformOrders(h.state, 0)).toHaveLength(1);

    expect(send(h, cmd('dev.seed', { seed: 'reseed' })).code).toBeUndefined();
    expect(getColonyTerraformOrders(h.state, 0)).toEqual([]);
    expect(getConstructionOrders(h.state)).toEqual([]);
    expect([layers.owner[far], layers.anchors[far], layers.explored[far] & 1]).toEqual([-1, 0, 0]);
    expect(layers.explored[hexIndex(h.state.grid.radius).indexOf(1, 0)] & 1).toBe(1); // the HQ sees its surroundings again
    expect(rowOf(h.state.entities, hqId)).toBeGreaterThanOrEqual(0);
  });

  it('dev.teleport with entityId <= 0 teleports colony HQ and updates target coords', () => {
    const h = w01Host();
    const hqId = spawnHqUnit(h.state, { owner: 0, q: 0, r: 0 });
    const slot = rowOf(h.state.entities, hqId);

    const outcome = send(h, cmd('dev.teleport', { entityId: 0, q: 4, r: -3 }));
    expect(outcome.code).toBeUndefined();

    const cols = h.state.entities.cols;
    expect(cols.q[slot]).toBe(4);
    expect(cols.r[slot]).toBe(-3);
    expect(cols.x[slot]).toBe(4);
    expect(cols.y[slot]).toBe(-3);
    expect(cols.targetQ[slot]).toBe(4);
    expect(cols.targetR[slot]).toBe(-3);
  });

  it('dev.land lands colony drop pod and deploys HQ', () => {
    const h = w01Host();
    const outcome = send(h, cmd('dev.land', {}));
    expect(outcome.code).toBeUndefined();

    const cols = h.state.entities.cols;
    let foundHq = false;
    for (let i = 0; i < h.state.entities.count; i++) {
      if (cols.kind[i] === 3) foundHq = true; // ENTITY_KIND.hq
    }
    expect(foundHq).toBe(true);
  });
});
