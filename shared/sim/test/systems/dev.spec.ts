import { describe, expect, it } from 'vitest';
import { createPlanet, rowOf, SimHost, type SimCommand } from '../../src';
import { DEV_ENTITY_KIND } from '../../src/systems/dev';
import { spawnHqUnit, stepTerraformWorkWithCell } from '../../src/systems/hq';
import { getColonyStock } from '../../src/systems/landing';

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
  const h = new SimHost({ flags: ['W00', 'W01'] });
  h.load(createPlanet({ type: 'temperate', seed: 'w01-dev', radius: 10 }));
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

  it('dev.grant adds stock with full resource key or shorthand', () => {
    const h = w01Host();
    send(h, cmd('dev.grant', { resource: 'metals.t1', amount: 500 }));
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(500);

    send(h, cmd('dev.grant', { resource: 'metals', amount: 250 }));
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(750);

    send(h, cmd('dev.grant', { resource: 'minerals', amount: 300 }));
    expect(getColonyStock(h.state, 0)['minerals.t1']).toBe(300);

    send(h, cmd('dev.grant', { resource: 'biomass', amount: 150 }));
    expect(getColonyStock(h.state, 0)['bio.biomass']).toBe(150);

    send(h, cmd('dev.grant', { resource: 'water', amount: 75 }));
    expect(getColonyStock(h.state, 0)['bio.water']).toBe(75);
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

  it('dev.seed regenerates planet terrain with new seed', () => {
    const h = w01Host();
    expect(h.state.meta.seed).toBe('w01-dev');

    const outcome = send(h, cmd('dev.seed', { seed: 'new-seed-123' }));
    expect(outcome.code).toBeUndefined();
    expect(h.state.meta.seed).toBe('new-seed-123');
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
