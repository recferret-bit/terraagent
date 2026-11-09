import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeAtlasSectorColonyMetrics,
  evaluateCrossSectorPlacement,
  getAtlasBlob,
  globalTileToSector,
  inspectCrossSectorPath,
  inspectCrossSectorPowerGrid,
  runSmallAtlasBenchmark,
  validateSeedCorpusLandingSites,
  W11_SMALL_ATLAS_PERF_CAPS,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario } from '../_loader';

const COMPLETED_H_ISSUES = [
  'W11-01',
  'W11-02',
  'W11-03',
  'W11-04',
  'W11-06',
  'W11-07',
  'W11-08',
  'W11-10',
  'W11-11',
  'W11-12',
  'W11-13',
  'W11-15',
  'W11-20',
  'W11-22',
  'W11-32',
  'W11-33',
  'W11-34',
  'W11-35',
  'W11-36',
  'W11-37',
  'W11-38',
  'W11-39',
  'W11-40',
  'W11-41',
  'W11-42',
  'W11-43',
  'W11-46',
  'W11-47',
] as const;

const DEFERRED_UNTAGGED_ISSUES = [
  'W11-05',
  'W11-09',
  'W11-14',
  'W11-16',
  'W11-17',
  'W11-18',
  'W11-19',
  'W11-21',
  'W11-23',
  'W11-24',
  'W11-25',
  'W11-26',
  'W11-27',
  'W11-28',
  'W11-29',
  'W11-30',
  'W11-31',
  'W11-44',
  'W11-45',
] as const;

describe('W11 seed scenario (w11 / w11-lobby), atlas corpus, perf caps & W27 readiness manifest', () => {
  it('discovers w11 by id and file name and builds deterministically across runs', () => {
    const byId = getScenario('w11');
    const byFile = getScenario('w11-lobby');
    expect(byId).toBeDefined();
    expect(byFile).toBe(byId);
    expect(byId?.id).toBe('w11');
    expect(byId?.title).toBe('W11 Planet Foundations & Sector Admission');
    expect(byId?.waves).toBe('..11');
    expect(byId?.seed).toBe('w11-lobby-planets');

    const runA = createScenarioPlanet('w11', { planetId: 'pl_w11_a' });
    const runB = createScenarioPlanet('w11-lobby', { planetId: 'pl_w11_b' });

    expect(runA.host.state.colonies).toEqual(runB.host.state.colonies);
    expect(runA.host.state.blobs.atlas).toEqual(runB.host.state.blobs.atlas);
    expect(runA.host.state.entities.count).toBe(runB.host.state.entities.count);

    const col0 = runA.host.state.colonies[0];
    expect(col0).toBeDefined();
    expect(col0?.id).toBe('col_0');
    expect(col0?.name).toBe('Aegis Prime');
    expect(col0?.foundingSectorId).toBe('sec_0_0');
    expect(col0?.landingSlotId).toBe('slot_sec_0_0_0');
  });
});

describe('W11 isolated 4x sector (R=48, 7,057 tiles) & disabled cross-sector gameplay', () => {
  it('populates the 19-sector small-atlas manifest, boots an isolated 4x sector (R=48, 7,057 tiles), and disables cross-sector gameplay', () => {
    const { host } = createScenarioPlanet('w11');
    const state = host.state;
    expect(state.grid.radius).toBe(48);
    expect(state.grid.count).toBe(7057);

    const atlas = getAtlasBlob(state);
    expect(atlas).toBeDefined();
    expect(atlas?.sectors).toHaveLength(19);
    expect(atlas?.manifest?.totalSectors).toBe(19);
    expect(atlas?.manifest?.landSectors).toBe(7);
    expect(atlas?.manifest?.oceanSectors).toBe(12);
    expect(atlas?.sectorRadius).toBe(48);
    expect(atlas?.foundingSeatsPerSector).toBe(4);
    expect(atlas?.sectors.every((s) => s.tileCount === 7057)).toBe(true);

    expect(globalTileToSector(24, -12, 48).sectorId).toBe('sec_0_0');
    expect(globalTileToSector(48, -24, 48).sectorId).toBe('sec_0_0');
    expect(globalTileToSector(49, -24, 48).sectorId).toBe('sec_1_0');

    const intraSectorPath = inspectCrossSectorPath(
      state,
      { q: 24, r: -12 },
      { q: 26, r: -13 },
      { sectorRadius: 48 },
    );
    expect(intraSectorPath.ok).toBe(true);
    expect(intraSectorPath.crossesSectorBoundary).toBe(false);
    expect(intraSectorPath.startSectorId).toBe('sec_0_0');
    expect(intraSectorPath.goalSectorId).toBe('sec_0_0');

    const outOfGridSectorPath = inspectCrossSectorPath(
      state,
      { q: 24, r: -12 },
      { q: 49, r: -24 },
      { sectorRadius: 48 },
    );
    expect(outOfGridSectorPath.ok).toBe(false);
    expect(outOfGridSectorPath.reason).toBe('goal_out_of_bounds');
    expect(outOfGridSectorPath.crossesSectorBoundary).toBe(false);
    expect(outOfGridSectorPath.startSectorId).toBe('sec_0_0');
    expect(outOfGridSectorPath.goalSectorId).toBe('sec_1_0');

    const crossSectorPath = inspectCrossSectorPath(
      state,
      { q: 24, r: -12 },
      { q: 26, r: -13 },
      { sectorRadius: 24 },
    );
    expect(crossSectorPath.ok).toBe(false);
    expect(crossSectorPath.reason).toBe('cross_sector_disabled');
    expect(crossSectorPath.crossesSectorBoundary).toBe(false);
    expect(crossSectorPath.startSectorId).toBe('sec_0_0');
    expect(crossSectorPath.goalSectorId).toBe('sec_1_0');

    const intraPlaceDiag = evaluateCrossSectorPlacement(state, {
      colonyId: 0,
      building: 'solar',
      q: 26,
      r: -15,
      sectorRadius: 48,
    });
    expect(intraPlaceDiag.ok).toBe(true);
    expect(intraPlaceDiag.anchorSectorId).toBe('sec_0_0');

    const crossPlaceDiag = evaluateCrossSectorPlacement(state, {
      colonyId: 0,
      building: 'solar',
      q: 49,
      r: -24,
      sectorRadius: 48,
    });
    expect(crossPlaceDiag.ok).toBe(false);
    expect(crossPlaceDiag.anchorSectorId).toBe('sec_1_0');

    const powerDiag = inspectCrossSectorPowerGrid(state, 0);
    expect(powerDiag.crossSectorRelayLinks).toHaveLength(0);
    expect(powerDiag.spansMultipleSectors).toBe(false);
    expect(powerDiag.connectedSectorIds).toEqual(['sec_0_0']);

    const metrics = computeAtlasSectorColonyMetrics(state);
    expect(metrics.foundingSectorByColony[0]).toBe('sec_0_0');
    expect(metrics.presentSectorsByColony[0]).toEqual(['sec_0_0']);
    expect(metrics.get('sec_0_0')?.foundedSeats).toBe(1);
    expect(metrics.get('sec_0_0')?.presentColonies).toBe(1);
    expect(metrics.get('sec_1_0')?.foundedSeats).toBe(0);
    expect(metrics.get('sec_1_0')?.presentColonies).toBe(0);
  });
});

describe('W11 safe landing site corpus, W11-43 perf caps & W27 readiness manifest', () => {
  it('verifies the 3-profile × X=3/4/5 safe landing site corpus and W11-43 performance caps (w27ScaleClaimed === false)', () => {
    const corpus = validateSeedCorpusLandingSites({
      planetTypes: ['desert', 'ocean', 'temperate'],
      capacities: [3, 4, 5],
      seeds: ['w11-lobby-planets'],
    });
    expect(corpus.ok).toBe(true);
    expect(corpus.entries).toHaveLength(9);
    for (const entry of corpus.entries) {
      expect(entry.validation.ok).toBe(true);
      expect(entry.validatedCapacity).toBe(7 * entry.foundingSeatsPerSector);
    }

    expect(W11_SMALL_ATLAS_PERF_CAPS.w27ScaleClaimed).toBe(false);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxCanonicalWorlds).toBe(3);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTotalSectors).toBe(19);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxLandSectors).toBe(7);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxOceanSectors).toBe(12);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxSectorRadius).toBe(48);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTilesPerSector).toBe(7_057);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTotalTiles).toBe(134_083);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTotalFoundingSeatsPerWorld).toBe(35);

    const bench = runSmallAtlasBenchmark({
      seed: 'w11-lobby-planets',
      activeColonies: 4,
      simSteps: 6,
    });
    expect(bench.w27ScaleClaimed).toBe(false);
    expect(bench.caps.w27ScaleClaimed).toBe(false);
    expect(bench.withinBudget).toBe(true);
  });

  it('verifies docs/plan/w27-readiness-manifest.md and docs/plan/checks/w11-check.md completeness', () => {
    expect(COMPLETED_H_ISSUES).toHaveLength(28);
    expect(DEFERRED_UNTAGGED_ISSUES).toHaveLength(19);

    const rootDir = resolve(__dirname, '../../..');
    const manifestMd = readFileSync(resolve(rootDir, 'docs/plan/w27-readiness-manifest.md'), 'utf8');
    expect(manifestMd).toContain('"w27Ready": false');
    expect(manifestMd).toContain('"w27ScaleClaimed": false');
    expect(manifestMd).toContain('W11_SMALL_ATLAS_PERF_CAPS');
    expect(manifestMd).toContain('MAP_EXTENSION_HANDOFF.md');

    for (const id of COMPLETED_H_ISSUES) {
      expect(manifestMd).toContain(id);
    }
    for (const id of DEFERRED_UNTAGGED_ISSUES) {
      expect(manifestMd).toContain(id);
    }

    const checkMd = readFileSync(resolve(rootDir, 'docs/plan/checks/w11-check.md'), 'utf8');
    expect(checkMd).toContain('http://127.0.0.1:5273');
    expect(checkMd).toContain('http://127.0.0.1:4101');
    expect(checkMd).toContain('?scenario=w11');
    expect(checkMd).toContain('&waves=..10');
    expect(checkMd).toContain('?host=local&scenario=w11');
    expect(checkMd).toContain('w27-readiness-manifest.md');
    expect(checkMd).toContain('npm run wave -- land 11');
  });
});
