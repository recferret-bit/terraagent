import { describe, expect, it } from 'vitest';
import { PlacementTable } from '../../src/game/placement/placement-table';
import { PlanetMover } from '../../src/game/placement/planet-mover';
import type { FromThread, ToThread } from '../../src/game/thread/protocol';

const cmd = (commandId: string) => ({ colonyIndex: null, source: 'dev' as const, commandId, kind: 'x', args: {} });

/** A mover over a 3-thread table with planet `p` loaded on thread 0, and a fake port that records traffic. */
function rig(dead: number[] = []) {
  const table = new PlacementTable(3);
  const sent: { thread: number; msg: ToThread }[] = [];
  const emitted: { thread: number; msg: FromThread }[] = [];
  const mover = new PlanetMover(table, {
    send: (thread, msg) => { if (dead.includes(thread)) return false; sent.push({ thread, msg }); return true; },
    emit: (thread, msg) => emitted.push({ thread, msg }),
  });
  table.placeAt(0, { t: 'load', planetId: 'p', flags: ['W00'] });
  table.route('p', { t: 'subscribe', planetId: 'p' });
  table.afterMessage(0, { t: 'loaded', planetId: 'p', tick: 0 });
  const handedOff = (tick = 42): FromThread => ({ t: 'handedOff', planetId: 'p', tick, bytes: new Uint8Array([1, 2, 3]), pending: [cmd('queued')] });
  return { table, mover, sent, emitted, handedOff };
}

describe('PlanetMover (3.2)', () => {
  it('handoff -> load on the target with the route state -> queued and buffered commands in order -> moved', () => {
    const r = rig();
    expect(r.mover.start('p', 2)).toBe(true);
    expect(r.sent[0]).toEqual({ thread: 0, msg: { t: 'unload', planetId: 'p', handoff: true } });
    expect(r.mover.buffer('p', { t: 'cmd', planetId: 'p', cmd: cmd('during') }, [])).toBe(true);
    expect(r.mover.intercept(0, r.handedOff())).toBe(true);
    expect(r.table.threadOf('p')).toBe(2);
    expect(r.sent[1]).toMatchObject({ thread: 2, msg: { t: 'load', planetId: 'p', flags: ['W00'], moved: { subscribed: true } } });
    expect(r.mover.intercept(2, { t: 'loaded', planetId: 'p', tick: 42 })).toBe(true); // not for the listeners
    expect(r.sent.slice(2).map((s) => [s.thread, s.msg.t === 'cmd' ? s.msg.cmd.commandId : s.msg.t])).toEqual([[2, 'queued'], [2, 'during']]);
    expect(r.emitted).toEqual([{ thread: 2, msg: { t: 'moved', planetId: 'p', from: 0, to: 2, tick: 42 } }]);
    expect(r.mover.isMoving('p')).toBe(false);
    expect(r.mover.buffer('p', { t: 'cmd', planetId: 'p', cmd: cmd('later') }, [])).toBe(false);
  });

  it('a target that refuses the load sends the planet back to its source', () => {
    const r = rig();
    r.mover.start('p', 1);
    r.mover.intercept(0, r.handedOff());
    expect(r.mover.intercept(1, { t: 'error', thread: 1, planetId: 'p', message: 'bad load' })).toBe(true);
    expect(r.table.threadOf('p')).toBe(0);
    expect(r.sent.at(-1)).toMatchObject({ thread: 0, msg: { t: 'load', planetId: 'p' } });
    r.mover.intercept(0, { t: 'loaded', planetId: 'p', tick: 42 });
    expect(r.emitted.at(-1)).toMatchObject({ msg: { t: 'moved', from: 0, to: 0 } });
  });

  it('when the source refuses it too, the planet is reported failed (waiters answered, recovery runs), not left on no thread', () => {
    const r = rig();
    r.mover.start('p', 1);
    r.mover.intercept(0, r.handedOff());
    r.mover.intercept(1, { t: 'error', thread: 1, planetId: 'p', message: 'bad load' });
    r.mover.intercept(0, { t: 'error', thread: 0, planetId: 'p', message: 'bad load again' });
    expect(r.emitted).toEqual([{ thread: 0, msg: { t: 'planetFailed', planetId: 'p', message: expect.stringContaining('move from thread 0 failed') } }]);
    expect(r.table.get('p')).toBeUndefined();
    expect(r.mover.isMoving('p')).toBe(false);
  });

  it('a dead target at send time goes straight back to the source', () => {
    const r = rig([1]);
    r.mover.start('p', 1);
    r.mover.intercept(0, r.handedOff());
    expect(r.sent.at(-1)).toMatchObject({ thread: 0, msg: { t: 'load', planetId: 'p' } });
  });

  it('a planet that was not on its source after all: the move is off and the buffer goes out normally', () => {
    const r = rig();
    r.mover.start('p', 1);
    r.mover.buffer('p', { t: 'cmd', planetId: 'p', cmd: cmd('during') }, []);
    r.mover.intercept(0, { t: 'handedOff', planetId: 'p', tick: -1, pending: [] });
    expect(r.mover.isMoving('p')).toBe(false);
    expect(r.sent.at(-1)).toMatchObject({ msg: { t: 'cmd', cmd: { commandId: 'during' } } });
  });

  it('a thread dying mid-move ends the move (GamePlanets takes the planet down through threadOf)', () => {
    const r = rig();
    r.mover.start('p', 1);
    r.mover.threadDown(0); // the source died before its handoff
    expect(r.mover.isMoving('p')).toBe(false);
    expect(r.table.threadOf('p')).toBe(0);
    r.mover.start('p', 1);
    r.mover.intercept(0, r.handedOff());
    r.mover.threadDown(1); // the target died while loading
    expect(r.mover.isMoving('p')).toBe(false);
    expect(r.table.threadOf('p')).toBe(1);
  });

  it('refuses a move to the same thread, of an unknown planet, or of one already moving', () => {
    const r = rig();
    expect(r.mover.start('p', 0)).toBe(false);
    expect(r.mover.start('nope', 1)).toBe(false);
    expect(r.mover.start('p', 1)).toBe(true);
    expect(r.mover.start('p', 2)).toBe(false);
  });
});
