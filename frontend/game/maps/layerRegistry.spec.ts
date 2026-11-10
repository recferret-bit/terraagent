// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ALERT_PING_KINDS,
  eventDef,
  MAP_LAYER_IDS,
  MAP_LAYER_META,
  parseWaves,
} from '@terra/contracts';
import { loadFeatures, selectFeatures } from '../core/registry';
import { HudRoot } from '../core/hud/HudRoot';
import {
  createMapLayerRegistry,
  mapLayerRegistry,
  type MapLayer,
} from './index';
import flagsFeature from '../features/flags';
import mapsFeature, { mountMapsFeature } from '../features/maps';
import type { FeatureContext } from '../core/registry/types';

describe('W04-01 contracts and flag W04', () => {
  beforeEach(() => {
    mapLayerRegistry.clear();
  });

  it('defines MAP_LAYER_IDS and alertPing event schema in @terra/contracts', () => {
    expect(MAP_LAYER_IDS).toEqual([
      'territory',
      'sectors',
      'terrain',
      'terraformPct',
      'resources',
      'units',
      'threats',
      'market',
      'walls',
      'bounties',
    ]);
    expect(ALERT_PING_KINDS).toEqual([
      'underAttack',
      'raidIncoming',
      'meteorWarning',
      'ping',
    ]);
    const def = eventDef('alertPing');
    expect(def).toBeDefined();
    expect(def.wave).toBe('W04');
    const parsed = def.data.parse({ q: 4, r: -2, kind: 'underAttack' });
    expect(parsed).toEqual({ q: 4, r: -2, kind: 'underAttack' });
  });

  it('with TA_WAVES=..03 does not load maps and registers no map layers', () => {
    const waveSet = parseWaves('..03');
    expect(waveSet.has('W04')).toBe(false);

    const flags = new Set<string>(waveSet.list);
    const ctx = { flags, host: 'server', services: {} } as unknown as FeatureContext;

    const activeFeatures = loadFeatures(ctx);
    expect(activeFeatures.some((f) => f.id === 'maps')).toBe(false);

    const selected = selectFeatures([flagsFeature, mapsFeature], ctx);
    expect(selected.map((f) => f.id)).toEqual(['flags']);

    const host = document.createElement('div');
    const hud = new HudRoot(host, selected, ctx);
    expect(mapLayerRegistry.all()).toHaveLength(0);
    expect(mapLayerRegistry.forFlags(flags)).toHaveLength(0);

    hud.dispose();
  });
});

describe('W04-01 MapLayerRegistry wave filtering', () => {
  it('unregisters layers if welcome narrows flags from all to ..03 after initial mount', () => {
    const registry = createMapLayerRegistry();
    const flags = new Set<string>(parseWaves('..04').list);
    const ctx = { flags, host: 'server', services: {} } as unknown as FeatureContext;
    const el = document.createElement('div');

    const panel = mountMapsFeature(el, ctx, registry);
    expect(registry.all().map((l) => l.id)).toEqual(['territory', 'terrain', 'resources', 'units']);

    flags.delete('W04');
    panel.update?.({});
    expect(registry.all()).toHaveLength(0);
    expect(registry.forFlags(flags)).toHaveLength(0);

    panel.dispose();
  });

  it('filters registered layers by their wave flag when W04 is active', () => {
    const registry = createMapLayerRegistry();
    const mk = (id: keyof typeof MAP_LAYER_META): MapLayer => ({
      ...MAP_LAYER_META[id],
      draw: () => {},
    });
    for (const id of ['territory', 'terrain', 'units', 'threats', 'market', 'walls'] as const) {
      registry.register(mk(id));
    }

    const w04Flags = new Set<string>(parseWaves('..04').list);
    expect(registry.forFlags(w04Flags).map((l) => l.id)).toEqual([
      'territory',
      'terrain',
      'units',
    ]);

    const w14Flags = new Set<string>(parseWaves('..14').list);
    expect(registry.forFlags(w14Flags).map((l) => l.id)).toEqual([
      'territory',
      'terrain',
      'units',
      'threats',
      'market',
      'walls',
    ]);
  });
});
