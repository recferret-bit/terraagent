import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearFaunaVisualOverrides,
  FAUNA_VISUAL_SPECIES,
  registerFaunaVisualOverride,
  resolveFaunaBugArchetypeId,
  resolveFaunaHiveArchetypeId,
} from '@terra/render/kitbash';
import { PLANET_KINDS } from '@terra/render/planets/PlanetSpec';
import {
  COSMETIC_GESTURES,
  createSeededRng,
  deriveCosmeticGesture,
  FaunaSceneHost,
} from '../content/FaunaSceneHost';
import { createState, FAUNA_SCENES, syncURL } from '../state';

afterEach(() => {
  clearFaunaVisualOverrides();
  vi.unstubAllGlobals();
});

describe('W07-34 URL state and registry fixtures', () => {
  it('createState and syncURL parse and serialize faunaScene, faunaMode, and faunaSeed while preserving existing controls', () => {
    const defaults = createState(new URLSearchParams(''));
    expect(defaults.faunaScene).toBeNull();
    expect(defaults.faunaMode).toBe('bugs');
    expect(defaults.faunaSeed).toBe(42);

    const replaceState = vi.fn();
    vi.stubGlobal('location', { pathname: '/playground.html' });
    vi.stubGlobal('history', { replaceState });

    const defaultQuery = syncURL(defaults);
    expect(defaultQuery.has('faunaScene')).toBe(false);
    expect(defaultQuery.has('faunaMode')).toBe(false);
    expect(defaultQuery.has('faunaSeed')).toBe(false);

    const params = new URLSearchParams(
      'inspect=fauna.blackAnt&biome=oceanForest&view=front&work=1&workTarget=rock&build=66&depositStage=half&turntable=1&validate=1&lights=1&faunaScene=mixed&faunaMode=aggressive&faunaSeed=1337',
    );
    const parsed = createState(params);
    expect(parsed.faunaScene).toBe('mixed');
    expect(parsed.faunaMode).toBe('aggressive');
    expect(parsed.faunaSeed).toBe(1337);
    expect(parsed.kind).toBe('oceanForest');
    expect(parsed.view).toBe('front');
    expect(parsed.work).toBe(true);
    expect(parsed.workTarget).toBe('rock');
    expect(parsed.build).toBe(0.66);
    expect(parsed.depositStage).toBe('half');

    parsed.id = 'fauna.blackAnt';
    const serialized = syncURL(parsed);
    expect(serialized.get('inspect')).toBe('fauna.blackAnt');
    expect(serialized.get('biome')).toBe('oceanForest');
    expect(serialized.get('faunaScene')).toBe('mixed');
    expect(serialized.get('faunaMode')).toBe('aggressive');
    expect(serialized.get('faunaSeed')).toBe('1337');
    expect(replaceState).toHaveBeenCalled();
  });

  it('initializes all 4 hive-life fixtures across all 3 planet biomes via the fauna visual registry', () => {
    const scene = new THREE.Scene();
    const host = new FaunaSceneHost(scene);

    for (const biome of PLANET_KINDS) {
      for (const fixture of FAUNA_SCENES) {
        host.setScene(fixture, { biomeKey: biome, mode: 'passive', seed: 101 });
        const stats = host.getStats();
        expect(stats.scene).toBe(fixture);
        expect(stats.biomeKey).toBe(biome);
        expect(stats.modeLabel).toBe('NEUTRAL');

        if (fixture === 'mixed') {
          expect(stats.hives).toHaveLength(3);
          expect(stats.hives.map((h) => h.species)).toEqual([...FAUNA_VISUAL_SPECIES]);
          expect(stats.populationCount).toBe(17);
          expect(stats.maxPopulation).toBe(21);
        } else {
          const hive = stats.hives[0]!;
          expect(hive.species).toBe(fixture);
          expect(hive.hiveArchetypeId).toBe(resolveFaunaHiveArchetypeId(biome, fixture));
          expect(hive.bugArchetypeId).toBe(resolveFaunaBugArchetypeId(biome, fixture));
        }
      }
    }

    registerFaunaVisualOverride('forestRock', 'greenSpitter', 'hive', 'fauna.hive.greenSpitter.forest');
    registerFaunaVisualOverride('forestRock', 'greenSpitter', 'bug', 'fauna.greenSpitter.forest');
    host.setScene('greenSpitter', { biomeKey: 'forestRock', seed: 77 });
    const overrideStats = host.getStats();
    expect(overrideStats.hives[0]?.hiveArchetypeId).toBe('fauna.hive.greenSpitter.forest');
    expect(overrideStats.hives[0]?.bugArchetypeId).toBe('fauna.greenSpitter.forest');
  });
});

describe('W07-34 deterministic simulation, transport controls, and acid preview', () => {
  it('produces identical deterministic state for same seed and never alters RNG draws when toggling render/culling flags', () => {
    const hostA = new FaunaSceneHost();
    const hostB = new FaunaSceneHost();

    hostA.setScene('mixed', { seed: 2026, mode: 'passive', biomeKey: 'dune' });
    hostB.setScene('mixed', { seed: 2026, mode: 'passive', biomeKey: 'dune' });
    hostA.setPaused(true);
    hostB.setPaused(true);

    for (let t = 0; t < 20; t++) {
      hostA.stepTick(1);
      hostB.setRenderOptions({
        wire: t % 2 === 0,
        bloom: t % 3 === 0,
        shadows: t % 2 === 1,
        pixel: t % 4 === 0,
        culled: t % 2 === 0,
      });
      hostB.update(t * 0.16, 0.016);
      hostB.stepTick(1);
      expect(COSMETIC_GESTURES).toContain(deriveCosmeticGesture(2026, 'blackAnt:1', t));
    }

    const statsA = hostA.getStats();
    const statsB = hostB.getStats();
    expect(statsA.tick).toBe(20);
    expect(statsA.rngDraws).toBe(statsB.rngDraws);
    expect(statsA.waveCount).toBe(statsB.waveCount);
    expect(statsA.bugs).toEqual(statsB.bugs);

    const rng1 = createSeededRng(999);
    const rng2 = createSeededRng(999);
    expect([rng1.nextU32(), rng1.nextFloat(), rng1.nextInt(1, 10)]).toEqual([
      rng2.nextU32(),
      rng2.nextFloat(),
      rng2.nextInt(1, 10),
    ]);
    expect(rng1.draws).toBe(3);
  });

  it('supports pause, stepTick, reset, aggressive mode waves, and triggerAcidPreview()', () => {
    const host = new FaunaSceneHost();
    host.setScene('greenSpitter', { seed: 55, mode: 'passive', biomeKey: 'oceanForest' });

    const initial = host.getStats();
    expect(initial.tick).toBe(0);
    const initialDraws = initial.rngDraws;
    const initialBugs = initial.bugs;

    host.setPaused(true);
    expect(host.isPaused()).toBe(true);
    host.update(1.0, 1.0);
    expect(host.getStats().tick).toBe(0);

    host.stepTick(5);
    expect(host.getStats().tick).toBe(5);

    host.reset(55);
    const afterReset = host.getStats();
    expect(afterReset.tick).toBe(0);
    expect(afterReset.rngDraws).toBe(initialDraws);
    expect(afterReset.bugs).toEqual(initialBugs);

    host.setMode('aggressive');
    const aggroStart = host.getStats();
    expect(aggroStart.mode).toBe('aggressive');
    expect(aggroStart.modeLabel).toBe('AGGRESSIVE');
    expect(aggroStart.waveCount).toBe(1);
    expect(aggroStart.hives[0]?.targetColony).toBe('colony:0');

    host.stepTick(15);
    const aggroStepped = host.getStats();
    expect(aggroStepped.tick).toBe(15);
    expect(aggroStepped.bugs.some((b) => b.order === 'attack' || b.order === 'spit_acid')).toBe(true);

    const drawsBeforeAcid = host.getStats().rngDraws;
    host.projectiles.clear();
    host.triggerAcidPreview();
    const afterAcid = host.getStats();
    expect(afterAcid.rngDraws).toBe(drawsBeforeAcid);
    expect(afterAcid.activeProjectiles).toBeGreaterThanOrEqual(1);
    expect(host.projectiles.getActiveProjectiles()[0]?.weaponKind).toBe('acid');
    expect(host.projectiles.getActiveCounts().impacts).toBeGreaterThanOrEqual(1);
  });
});
