import { describe, expect, it } from 'vitest';
import {
  ENTITY_STATE,
  getUnitCommand,
  getUnitRecord,
  issueUnitCommand,
  rowOf,
  spawnHqUnit,
  type StepContext,
} from '../../src';
import { cmd, w01Host } from './helpers';
import type { SimHost } from '../../src';

/** A step context for issuing unit commands outside a command handler (as a system would). */
function ctxOf(host: SimHost): StepContext {
  const tick = host.tick;
  const base = { dt: 1, tick, flags: new Set(['W00', 'W01']), data: host['pipeline'].config.data, events: [], rng: () => new Uint32Array(4), newEntityId: () => 0, emit: () => undefined };
  // ledger hooks (economy): present on newer StepContexts, ignored by unit commands
  return Object.assign(base, { record: () => undefined, postings: [] }) as unknown as StepContext;
}

describe('unit commands (command pattern)', () => {
  it('stop halts a moving unit where it is and holds queued auto work for stopHoldS', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    host.submit(cmd('moveUnit', { entityId: hqId, q: 10, r: 0 }));
    host.step(5);
    host.submit(cmd('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: -1, r: 0 }] } }));
    host.submit(cmd('stopUnit', { entityId: hqId }));
    host.step(1);
    const cols = state.entities.cols;
    const stoppedAt = [cols.x[row], cols.y[row]];
    expect(cols.state[row]).toBe(ENTITY_STATE.idle);
    expect(getUnitCommand(state, hqId)).toBeNull();
    host.step(23);
    expect([cols.x[row], cols.y[row]]).toEqual(stoppedAt); // 4.6 s later: still holding the queued grade
    expect(getUnitCommand(state, hqId)).toBeNull();
    host.step(2);
    expect(getUnitCommand(state, hqId)).toMatchObject({ kind: 'terraform', source: 'auto' }); // 5 s hold over: back to work
  });

  it('player orders queue behind the current one; a new order replaces the queue', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    const ctx = ctxOf(host);
    expect(issueUnitCommand(state, row, { kind: 'move', source: 'player', q: 2, r: 0 }, ctx)).toBeUndefined();
    issueUnitCommand(state, row, { kind: 'move', source: 'player', q: 2, r: 2 }, ctx, { queue: true });
    expect(getUnitRecord(state, hqId)?.queue).toHaveLength(1);
    host.step(1);
    for (let t = 0; t < 40 && state.entities.cols.state[row] === ENTITY_STATE.moving; t++) host.step(1);
    expect([state.entities.cols.x[row], state.entities.cols.y[row]]).toEqual([2, 2]);
    expect(state.entities.cols.state[row]).toBe(ENTITY_STATE.idle);
    expect(getUnitRecord(state, hqId)?.queue).toHaveLength(0);

    issueUnitCommand(state, row, { kind: 'move', source: 'player', q: 5, r: 2 }, ctxOf(host));
    issueUnitCommand(state, row, { kind: 'move', source: 'player', q: 5, r: 5 }, ctxOf(host), { queue: true });
    issueUnitCommand(state, row, { kind: 'move', source: 'player', q: 0, r: 2 }, ctxOf(host)); // replaces both
    expect(getUnitRecord(state, hqId)).toMatchObject({ current: { kind: 'move', q: 0, r: 2 }, queue: [] });
  });

  it('a unit at 0 HP gets `die`: commands and route dropped, state inert, and it accepts no more orders', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    host.submit(cmd('moveUnit', { entityId: hqId, q: 10, r: 0 }));
    host.step(3);
    state.entities.cols.hp[row] = 0;
    host.step(1);
    expect(state.entities.cols.state[row]).toBe(ENTITY_STATE.inert);
    expect(getUnitRecord(state, hqId)).toMatchObject({ current: null, queue: [] });
    const x = state.entities.cols.x[row];
    host.submit(cmd('moveUnit', { entityId: hqId, q: -5, r: 0 }));
    expect(host.step(1).outcomes[0]?.code).toBe('invalid_args');
    expect(state.entities.cols.x[row]).toBe(x);
  });

  it('attack closes to weapon range (5) along a path, then deals 12 DPS until the target dies', () => {
    const host = w01Host();
    const state = host.state;
    const a = spawnHqUnit(state, { owner: 0, q: -6, r: 0 });
    const b = spawnHqUnit(state, { owner: 1, q: 6, r: 0 });
    const ra = rowOf(state.entities, a);
    const rb = rowOf(state.entities, b);
    const ctx = ctxOf(host);
    expect(issueUnitCommand(state, ra, { kind: 'attack', source: 'player', targetId: a }, ctx)).toBe('invalid_args'); // own unit: registered codes only (GP-20)
    expect(issueUnitCommand(state, ra, { kind: 'attack', source: 'player', targetId: b }, ctx)).toBeUndefined();
    host.step(1);
    const cols = state.entities.cols;
    expect(cols.state[ra]).toBe(ENTITY_STATE.moving);
    for (let t = 0; t < 30 && cols.hp[rb] === cols.hpMax[rb]; t++) host.step(1);
    expect(Math.abs(cols.x[ra] - cols.x[rb])).toBeLessThanOrEqual(5 + 1e-4);
    expect(Math.abs(cols.x[ra] - cols.x[rb])).toBeGreaterThan(4);
    const hp0 = cols.hp[rb];
    host.step(5); // 1 s
    expect(hp0 - cols.hp[rb]).toBeCloseTo(12, 3);
    cols.hp[rb] = 1;
    host.step(1);
    host.step(1);
    expect(cols.state[rb]).toBe(ENTITY_STATE.inert);
    expect(getUnitCommand(state, a)).toBeNull();
    expect(cols.state[ra]).toBe(ENTITY_STATE.idle);
  });
});
