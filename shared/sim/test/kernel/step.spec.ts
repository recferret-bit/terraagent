import { describe, expect, it } from 'vitest';
import { createPipeline, defineSystem, step, removeRow } from '../../src';
import { cmd, config, fresh, pipeline } from './fixtures';

describe('step', () => {
  it('acks with the produced tick and rejects unknown kinds, disabled waves and game-rule failures without throwing', () => {
    const s = fresh();
    const res = step(s, [cmd('test.spawn', { q: 0, r: 0 }), cmd('nope', {}), cmd('test.later', {}), cmd('test.kill', { id: 99 })], 1, pipeline);
    expect(res.outcomes.map((o) => o.code ?? 'ok')).toEqual(['ok', 'unknown_kind', 'wave_disabled', 'unknown_entity']);
    expect(res.outcomes[0].appliedAtTick).toBe(1);
    expect(res.stats).toMatchObject({ tick: 1, commands: 4, rejected: 3, entities: 1 });
  });

  it('runs systems in slot order and skips disabled waves', () => {
    const order: string[] = [];
    const mk = (id: string, slot: number, wave = 'W00') => defineSystem({ id, slot, wave, run: () => { order.push(id); } });
    const p = createPipeline({ ...config, systems: [mk('c', 14), mk('a', 3), mk('later', 2, 'W07'), mk('b', 3)] });
    step(fresh(), [], 1, p);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('rejects a slot outside 0..14', () => {
    expect(() => createPipeline({ ...config, systems: [defineSystem({ id: 'x', slot: 15, wave: 'W00', run() {} })] })).toThrow(/slot/);
  });

  it('keeps entity rows in ascending id order across removals and records them', () => {
    const s = fresh();
    step(s, [cmd('test.spawn', { q: 0, r: 0 }), cmd('test.spawn', { q: 1, r: 0 }), cmd('test.spawn', { q: 2, r: 0 })], 1, pipeline);
    removeRow(s.entities, 2, 2);
    expect([...s.entities.cols.id.subarray(0, s.entities.count)]).toEqual([1, 3]);
    expect(s.entities.removed).toEqual([{ id: 2, at: 2 }]);
    step(s, [cmd('test.spawn', { q: 3, r: 0 })], 1, pipeline);
    expect([...s.entities.cols.id.subarray(0, s.entities.count)]).toEqual([1, 3, 4]);
  });

  it('grows past the initial capacity', () => {
    const s = fresh();
    step(s, Array.from({ length: 200 }, (_, i) => cmd('test.spawn', { q: 0, r: i % 3 })), 1, pipeline);
    expect(s.entities.count).toBe(200);
    expect(s.entities.capacity).toBe(256);
  });
});
