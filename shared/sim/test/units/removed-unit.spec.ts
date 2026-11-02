import { describe, expect, it } from 'vitest';
import { getMotion, removeRow, rowOf, spawnHqUnit } from '../../src';
import { cmd, w01Host } from './helpers';

describe('GP-29: a unit removed while it follows a route', () => {
  it('its motion and path request are dropped on the next step; nothing else moves', () => {
    const host = w01Host(12, 'removed-unit');
    const id = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    host.submit(cmd('moveUnit', { entityId: id, q: 8, r: 0 }));
    host.step(3);
    expect(getMotion(host.state, id)).not.toBeNull();
    removeRow(host.state.entities, id, host.tick);
    host.step(1);
    expect(rowOf(host.state.entities, id)).toBe(-1);
    expect(getMotion(host.state, id)).toBeNull();
  });
});
