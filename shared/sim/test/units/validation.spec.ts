import { describe, expect, it } from 'vitest';
import { precheckClientCommand } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE, insertRow, rowOf, spawnHqUnit } from '../../src';
import { cmd, w01Host } from './helpers';

const gate = { gate: () => null, production: true, hasColony: true };

describe('unit command input validation (contract precheck on every host, then the sim rules)', () => {
  it('the contract rejects malformed moveUnit / stopUnit args before they reach the sim', () => {
    for (const args of [
      {},
      { entityId: 1 },
      { entityId: 0, q: 1, r: 1 },
      { entityId: -3, q: 1, r: 1 },
      { entityId: 1.5, q: 1, r: 1 },
      { entityId: 1, q: 0.5, r: 1 },
      { entityId: 1, q: '1', r: 1 },
      { entityId: 1, q: 1, r: 99999 },
      { entityId: 1, q: 1, r: 1, extra: true },
      { entityId: 1, to: { q: 1, r: 1 } },
    ]) {
      expect(precheckClientCommand('moveUnit', args, gate), JSON.stringify(args)).toMatchObject({ ok: false, code: 'invalid_args' });
    }
    expect(precheckClientCommand('moveUnit', { entityId: 1, q: 1, r: -1 }, gate)).toMatchObject({ ok: true });
    expect(precheckClientCommand('stopUnit', { entityId: 1, q: 1 }, gate)).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(precheckClientCommand('stopUnit', { entityId: 1 }, gate)).toMatchObject({ ok: true });
    expect(precheckClientCommand('stopUnit', { entityId: 1 }, { ...gate, hasColony: false })).toMatchObject({ ok: false, code: 'not_own_colony' });
  });

  it('the sim handler rejects units that are not yours, not units, dead, or targets off the map', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const enemyId = spawnHqUnit(state, { owner: 1, q: 5, r: 5 });
    const hubId = state.meta.nextEntityId++;
    const hubRow = insertRow(state.entities, hubId, state.meta.tick);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.hub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 12; // well away from the HQ (its footprint blocks movement)
    state.entities.cols.r[hubRow] = -12;
    const send = (kind: string, args: unknown) => {
      host.submit(cmd(kind, args));
      return host.step(1).outcomes[0]?.code;
    };
    expect(send('moveUnit', { entityId: 9999, q: 1, r: 0 })).toBe('unknown_entity');
    expect(send('moveUnit', { entityId: 0, q: 1, r: 0 })).toBe('invalid_args');
    expect(send('moveUnit', { entityId: enemyId, q: 1, r: 0 })).toBe('not_own_colony');
    expect(send('stopUnit', { entityId: enemyId })).toBe('not_own_colony');
    expect(send('moveUnit', { entityId: hubId, q: 1, r: 0 })).toBe('invalid_args');
    expect(send('moveUnit', { entityId: hqId, q: 500, r: 0 })).toBe('invalid_args');
    expect(send('moveUnit', { entityId: hqId, q: 1.5, r: 0 })).toBe('invalid_args');
    expect(send('moveUnit', { entityId: hqId, q: 1, r: 0 })).toBeUndefined();
    state.entities.cols.hp[rowOf(state.entities, hqId)] = 0;
    host.step(1);
    expect(state.entities.cols.state[rowOf(state.entities, hqId)]).toBe(ENTITY_STATE.inert);
    expect(send('moveUnit', { entityId: hqId, q: 2, r: 0 })).toBe('invalid_args');
    expect(send('stopUnit', { entityId: hqId })).toBe('invalid_args');
  });

  it('a flood of orders costs one live path request per unit, not one per order', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    for (let i = 0; i < 200; i++) host.submit(cmd('moveUnit', { entityId: hqId, q: (i % 15) - 7, r: 3 }));
    host.step(1);
    const queue = (state.blobs.pathQueue?.value ?? []) as unknown[];
    expect(queue.length).toBeLessThanOrEqual(1);
  });
});
