import { describe, expect, it } from 'vitest';
import { allHandlers, allModules, allSystems, createEngineConfig, createRegistryPipeline, defineSimModule, defineSystem, step } from '../src';
import { fresh as newState } from './kernel/fixtures';

describe('sim registry', () => {
  it('discovers the finalize module via the generated list', () => {
    expect(allModules().map((m) => m.id)).toContain('finalize');
    expect(allSystems().find((s) => s.id === 'finalize')?.slot).toBe(14);
    expect(allHandlers().map((h) => h.kind)).toEqual(expect.arrayContaining(['dev.ping', 'dev.spawn', 'dev.nudge', 'dev.teleport']));
  });

  it('builds a pipeline from the registry that runs', () => {
    const p = createRegistryPipeline({ flags: ['W00'] });
    const state = newState();
    const r = step(state, [], 1, p);
    expect(r.stats.tick).toBe(1);
    expect(state.meta.tick).toBe(1);
    expect(p.systems.map((s) => s.id)).toContain('finalize');
  });

  it('treats unregistered slots as no-ops and still advances the tick', () => {
    const only14 = createRegistryPipeline({ flags: ['W00'] });
    expect(only14.systems.every((s) => s.slot === 14)).toBe(true);
    const state = newState();
    const t0 = state.meta.tick;
    step(state, [], 3, only14);
    expect(state.meta.tick).toBe(t0 + 3);
  });

  it('accepts extra modules and runs them in slot order', () => {
    const order: string[] = [];
    const mk = (id: string, slot: number) => defineSystem({ id, slot, wave: 'W00', run() { order.push(id); } });
    const extra = defineSimModule({ id: 'extra', wave: 'W00', systems: [mk('b', 9), mk('a', 2)] });
    const cfg = createEngineConfig({ flags: ['W00'], modules: [...allModules(), extra] });
    const p = createRegistryPipeline({ flags: ['W00'], modules: [...allModules(), extra] });
    expect(cfg.systems).toHaveLength(3);
    step(newState(), [], 1, p);
    expect(order).toEqual(['a', 'b']);
  });
});
