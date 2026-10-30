import { describe, expect, it } from 'vitest';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { DEV_ENTITY_KIND } from '../../src/systems/dev';

let n = 0;
const cmd = (kind: string, args: unknown): SimCommand => ({ colonyIndex: null, source: 'dev', commandId: `d${++n}`, kind, args });

function host(): SimHost {
  const h = new SimHost({ flags: ['W00'] });
  h.load(createPlanet({ type: 'flat', seed: 'dev', radius: 6 }));
  return h;
}
const run = (h: SimHost, c: SimCommand) => h.step(1).outcomes.find((o) => o.commandId === c.commandId)!;
const send = (h: SimHost, c: SimCommand) => { h.submit(c); return run(h, c); };

describe('dev commands', () => {
  it('ping changes no state and emits dev.pong with the note', () => {
    const h = host();
    const before = h.state.entities.count;
    const c = cmd('dev.ping', { note: 'hi' });
    h.submit(c);
    const res = h.step(1);
    expect(res.outcomes[0]).toMatchObject({ commandId: c.commandId, appliedAtTick: h.tick });
    expect(res.outcomes[0].code).toBeUndefined();
    expect(res.events).toMatchObject([{ kind: 'dev.pong', data: { note: 'hi' } }]);
    expect(h.state.entities.count).toBe(before);
  });

  it('spawn inserts kind 1 at the tile centre; nudge moves by the data row; teleport sets', () => {
    const h = host();
    expect(send(h, cmd('dev.spawn', { q: 2, r: -1 })).code).toBeUndefined();
    const e = h.state.entities;
    const id = e.cols.id[0];
    expect([e.cols.kind[0], e.cols.x[0], e.cols.y[0], e.cols.q[0], e.cols.r[0]]).toEqual([DEV_ENTITY_KIND, 2, -1, 2, -1]);
    const tick = h.tick;
    expect(send(h, cmd('dev.nudge', { id }))).toMatchObject({ appliedAtTick: tick + 1 });
    expect([e.cols.x[0], e.cols.y[0], e.cols.changedAt[0]]).toEqual([3, -1, tick + 1]);
    send(h, cmd('dev.nudge', { id, dr: 1 }));
    expect([e.cols.x[0], e.cols.y[0]]).toEqual([3, 0]);
    send(h, cmd('dev.teleport', { id, q: -4, r: 5 }));
    expect([e.cols.x[0], e.cols.y[0], e.cols.q[0], e.cols.r[0]]).toEqual([-4, 5, -4, 5]);
  });

  it('rejects unknown entities', () => {
    const h = host();
    expect(send(h, cmd('dev.nudge', { id: 99 })).code).toBe('unknown_entity');
    expect(send(h, cmd('dev.teleport', { id: 99, q: 0, r: 0 })).code).toBe('unknown_entity');
  });

  it('nudge is visible in a diff', () => {
    const h = host();
    send(h, cmd('dev.spawn', { q: 0, r: 0 }));
    const from = h.tick;
    send(h, cmd('dev.nudge', { id: h.state.entities.cols.id[0] }));
    const replica = h.clone();
    expect(h.diffSince(from).byteLength).toBeGreaterThan(0);
    expect(replica.state.entities.cols.x[0]).toBe(1);
  });
});
