import { afterEach, describe, expect, it } from 'vitest';
import type { FeatureContext, FeatureServices, RendererInstance } from '../../core/registry/types';
import tickFeature, { tickCommand, trackTick } from './index';

type Services = Omit<FeatureServices, 'track'>;
const ctxWith = (services: Services = {}): FeatureContext =>
  ({ flags: new Set(['W00']), host: 'server', services: { track: () => {}, ...services } });
const storeAt = (tick: number | undefined): Services =>
  ({ store: { latest: tick === undefined ? undefined : ({ tick } as never) } });
const run = (services: Services = {}) => tickCommand.run([], ctxWith(services));

let tracker: RendererInstance | null = null;
const mountTracker = (): RendererInstance => {
  tracker = tickFeature.renderers![0]!.mount(ctxWith());
  return tracker;
};
afterEach(() => {
  tracker?.dispose();
  tracker = null;
});

describe('tick feature (console command, no HUD chip)', () => {
  it('registers the `tick` dev command and a tracker renderer, and no HUD panel', () => {
    expect(tickFeature.id).toBe('tick');
    expect(tickFeature.hud ?? []).toEqual([]);
    expect(tickFeature.devCommands?.map((c) => c.name)).toEqual(['tick']);
    expect(tickFeature.renderers?.map((r) => r.id)).toEqual(['tick-tracker']);
    expect(tickCommand.help).toMatch(/^tick\s/);
  });

  it('answers "no view yet" without a store view or tracked tick', () => {
    mountTracker();
    expect(run()).toBe('tick: no view yet');
    expect(run(storeAt(undefined))).toBe('tick: no view yet');
    expect(run({ store: {} })).toBe('tick: no view yet');
  });

  it('prefers the store’s newest view over the tracker', () => {
    mountTracker().update({ tick: 7 }, 0);
    expect(run(storeAt(42))).toBe('tick 42');
  });

  it('falls back to the renderer tracker when the store has no view', () => {
    mountTracker().update({ tick: 7 }, 0);
    expect(run()).toBe('tick 7');
    expect(run(storeAt(undefined))).toBe('tick 7');
  });

  it('tick 0 is a real tick, from the store and from the tracker', () => {
    mountTracker().update({ tick: 0 }, 0);
    expect(run()).toBe('tick 0');
    expect(run(storeAt(0))).toBe('tick 0');
  });

  it('the tracker ignores negative and missing ticks and keeps the last good one', () => {
    const t = mountTracker();
    t.update({ tick: -1 }, 0);
    expect(run()).toBe('tick: no view yet');
    t.update({ tick: 12 }, 0);
    t.update({ tick: -5 }, 0);
    t.update({}, 0);
    expect(run()).toBe('tick 12');
    trackTick({ tick: 13 });
    expect(run()).toBe('tick 13');
  });

  it('a negative store tick is not shown (and does not fall back to the tracker)', () => {
    mountTracker().update({ tick: 9 }, 0);
    expect(run(storeAt(-1))).toBe('tick: no view yet');
  });

  it('mount and dispose reset the tracker (a new session starts empty)', () => {
    mountTracker().update({ tick: 5 }, 0);
    tracker!.dispose();
    tracker = null;
    expect(run()).toBe('tick: no view yet');
    trackTick({ tick: 3 });
    mountTracker();
    expect(run()).toBe('tick: no view yet');
  });
});
