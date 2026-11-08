import { eventDef, parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet } from '../../../../tests/scenarios';
import {
  compileData,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  evaluateExtractorTierGate,
  getBuildingFootprintTiles,
  getExtractorRingCacheDiagnostics,
  getExtractorRingStats,
  hexDistance,
  hexIndex,
  placeMetalsExtractor,
  PREP,
  resolveTierGateSpecs,
  setTileDeposit,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnWorkerUnit,
  startBuildingConstruction,
  step,
  syncColonyTerraformStats,
  TERRAIN,
  view,
  type StepContext,
} from '../../src';
import production from '../../src/systems/production';

function setupFlatColonyState(livingRatio = 0.35) {
  const state = createState({ planetId: 'p-tier', planetType: 'temperate', seed: 'tier-gate', radius: 10 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Colony 1',
    color: 0xff6b00,
    status: 'active',
    stage: 4,
    unlockStage: 4,
    changedAt: 0,
  });
  colony.caps.metals = 5000;
  colony.caps.minerals = 5000;
  colony.caps.bio = 5000;
  state.colonies.push(colony);

  const targetLiving = Math.ceil(state.grid.count * livingRatio);
  for (let i = 0; i < state.grid.count; i++) {
    setTileOwner(state, i, 0, 0);
    setTileTerrain(state, i, TERRAIN.flat, 0);
    setTilePrep(state, i, i < targetLiving ? PREP.living : PREP.flat, 0);
    setTileDeposit(state, i, DEPOSIT.none, 0, 0);
    state.grid.layers.height[i] = 0;
  }
  syncColonyTerraformStats(state, 0, 0);
  return { state, colony };
}

function setExtractorRingPrep(
  state: ReturnType<typeof createState>,
  anchorQ: number,
  anchorR: number,
  ratio: number,
  prepCode: number,
): void {
  const idx = hexIndex(state.grid.radius);
  const fp = getBuildingFootprintTiles(anchorQ, anchorR, 2);
  const fpSet = new Set(fp.map((p) => idx.indexOf(p.q, p.r)));
  for (const p of fp) {
    const fIdx = idx.indexOf(p.q, p.r);
    if (fIdx >= 0) setTilePrep(state, fIdx, PREP.prepared, 0);
  }
  const ringIndices: number[] = [];
  for (let r = anchorR - 2; r <= anchorR + 3; r++) {
    for (let q = anchorQ - 2; q <= anchorQ + 3; q++) {
      const tIdx = idx.indexOf(q, r);
      if (tIdx < 0 || fpSet.has(tIdx)) continue;
      let minDist = Infinity;
      for (const p of fp) {
        const d = hexDistance(q, r, p.q, p.r);
        if (d < minDist) minDist = d;
      }
      if (minDist >= 1 && minDist <= 2) {
        setTilePrep(state, tIdx, PREP.flat, 0);
        ringIndices.push(tIdx);
      }
    }
  }
  const target = Math.ceil(ringIndices.length * ratio);
  for (let i = 0; i < ringIndices.length; i++) {
    setTilePrep(state, ringIndices[i]!, i < target ? prepCode : PREP.flat, 0);
  }
}

describe('W05-34 Resource tier gate (D-34)', () => {
  it('reads thresholds, ring size, and splits from data rows (D-35 tunable) and disables when W05 is off', () => {
    const w05Data = compileData(parseWaves('..05'));
    const specs = resolveTierGateSpecs(w05Data);
    expect(specs.enabled).toBe(true);
    expect(specs.tier2).toEqual({
      tier: 2,
      minTerraformPct: 30,
      ringRadius: 2,
      minRingTerraformedRatio: 0.5,
      minRingLivingRatio: 0,
      t1Share: 0.7,
      t2Share: 0.3,
      t3Share: 0,
    });
    expect(specs.tier3).toEqual({
      tier: 3,
      minTerraformPct: 70,
      ringRadius: 2,
      minRingTerraformedRatio: 0.5,
      minRingLivingRatio: 0.5,
      t1Share: 0.5,
      t2Share: 0.3,
      t3Share: 0.2,
    });

    const w04Data = compileData(parseWaves('..04'));
    expect(resolveTierGateSpecs(w04Data).enabled).toBe(false);

    const tunedData = compileData(parseWaves('..05'), {
      terraform: {
        tier2Gate: { minTerraformPct: 25, t1Share: 0.6, t2Share: 0.4 },
      },
    });
    const tunedSpecs = resolveTierGateSpecs(tunedData);
    expect(tunedSpecs.tier2.minTerraformPct).toBe(25);
    expect(tunedSpecs.tier2.t1Share).toBe(0.6);
    expect(tunedSpecs.tier2.t2Share).toBe(0.4);
  });
});

describe('W05-34 Tiered yield split and tierUnlocked event', () => {
  it('opens T2 at >= 30% Terraform + >= 50% Irrigated/Living ring (70/30 split) and T3 at >= 70% + >= 50% Living (50/30/20 split)', () => {
    const { state, colony } = setupFlatColonyState(0.4);
    const idx = hexIndex(state.grid.radius);
    setTileDeposit(state, idx.indexOf(2, 0), DEPOSIT.metals, 10000, 0);
    setExtractorRingPrep(state, 2, 0, 0.55, PREP.irrigated);
    syncColonyTerraformStats(state, 0, 0);

    const placed = placeMetalsExtractor(state, { owner: 0, q: 2, r: 0 });
    expect(placed.ok).toBe(true);

    const events: Array<{ kind: string; data: unknown }> = [];
    const data = compileData(parseWaves('..05'));
    const run = production.systems!.find((s) => s.id === 'production.extractors')!.run;
    run(state, { tick: 1, dt: 5, data, flags: parseWaves('..05'), emit: (e: { kind: string; data: unknown }) => events.push(e) } as unknown as StepContext);

    // T2 open -> 70% metals.t1 / 30% metals.t2
    const totMetals = colony.stock['metals.t1'] + colony.stock['metals.t2'] + colony.stock['metals.t3'];
    expect(totMetals).toBeGreaterThan(0);
    expect(colony.stock['metals.t1'] / totMetals).toBeCloseTo(0.7, 5);
    expect(colony.stock['metals.t2'] / totMetals).toBeCloseTo(0.3, 5);
    expect(colony.stock['metals.t3']).toBe(0);

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('tierUnlocked');
    expect(eventDef('tierUnlocked').data.safeParse(events[0]!.data).success).toBe(true);
    expect(events[0]!.data).toMatchObject({ colonyId: 'col-0', family: 'metals', tier: 2 });

    // Now raise colony Terraform % to >= 70% and convert ring to >= 50% Living -> T3 open (50 / 30 / 20)
    setExtractorRingPrep(state, 2, 0, 0.6, PREP.living);
    let livNow = 0;
    const needLiv = Math.ceil(state.grid.count * 0.75);
    for (let i = 0; i < state.grid.count; i++) {
      if (state.grid.layers.prep[i] === PREP.living) livNow++;
    }
    for (let i = state.grid.count - 1; i >= 0 && livNow < needLiv; i--) {
      if (state.grid.layers.prep[i] !== PREP.living && state.grid.layers.prep[i] !== PREP.prepared) {
        setTilePrep(state, i, PREP.living, 0);
        livNow++;
      }
    }
    syncColonyTerraformStats(state, 0, 1);

    colony.stock['metals.t1'] = 0;
    colony.stock['metals.t2'] = 0;
    colony.stock['metals.t3'] = 0;

    run(state, { tick: 2, dt: 5, data, flags: parseWaves('..05'), emit: (e: { kind: string; data: unknown }) => events.push(e) } as unknown as StepContext);

    const totT3 = colony.stock['metals.t1'] + colony.stock['metals.t2'] + colony.stock['metals.t3'];
    expect(totT3).toBeGreaterThan(0);
    expect(colony.stock['metals.t1'] / totT3).toBeCloseTo(0.5, 5);
    expect(colony.stock['metals.t2'] / totT3).toBeCloseTo(0.3, 5);
    expect(colony.stock['metals.t3'] / totT3).toBeCloseTo(0.2, 5);
    expect(events).toHaveLength(2);
    expect(events[1]!.data).toMatchObject({ colonyId: 'col-0', family: 'metals', tier: 3 });

    // Mk tier only scales the rate, never the split
    const extRowIdx = 0;
    expect(state.entities.cols.kind[extRowIdx]).toBe(ENTITY_KIND.metalsExtractor);
    state.entities.cols.tier[extRowIdx] = 2;
    colony.stock['metals.t1'] = 0;
    colony.stock['metals.t2'] = 0;
    colony.stock['metals.t3'] = 0;
    run(state, { tick: 3, dt: 5, data, flags: parseWaves('..05') } as unknown as StepContext);
    const totMk2 = colony.stock['metals.t1'] + colony.stock['metals.t2'] + colony.stock['metals.t3'];
    expect(totMk2).toBeCloseTo(totT3 * 2, 4);
    expect(colony.stock['metals.t1'] / totMk2).toBeCloseTo(0.5, 5);
    expect(colony.stock['metals.t2'] / totMk2).toBeCloseTo(0.3, 5);
    expect(colony.stock['metals.t3'] / totMk2).toBeCloseTo(0.2, 5);
  });
});

describe('W05-34 Ring cache and w05-tiers scenario', () => {
  it('caches the ring ratio across ticks and refreshes when tileStateChanged fires', () => {
    const { state, colony } = setupFlatColonyState(0.4);
    colony.powerSupplyOverride = 200;
    colony.stock['bio.water'] = 200;
    colony.stock['minerals.t1'] = 200;
    const idx = hexIndex(state.grid.radius);
    const ringTileIdx = idx.indexOf(1, 0);
    setTileTerrain(state, ringTileIdx, TERRAIN.flat, 0);
    setTilePrep(state, ringTileIdx, PREP.prepared, 0);
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: -3, r: 0, instant: true, costOverride: {} });
    spawnWorkerUnit(state, { tier: 3, owner: 0, q: 0, r: 0 });

    const r1 = getExtractorRingStats(state, 2, 0, 2, 2, 0, 2);
    const diag1 = getExtractorRingCacheDiagnostics(state);
    expect(diag1.misses).toBe(1);
    expect(diag1.hits).toBe(0);

    const r2 = getExtractorRingStats(state, 2, 0, 2, 2, 0, 2);
    const diag2 = getExtractorRingCacheDiagnostics(state);
    expect(diag2.hits).toBe(1);
    expect(r2).toBe(r1);

    // Run an irrigate op on (1, 0) so tileStateChanged fires and invalidates the ring cache
    const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
    const enq = step(
      state,
      [{ commandId: 'irr', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'irrigate', tiles: [{ q: 1, r: 0 }] } } }],
      1,
      pipeline,
    );
    expect(enq.outcomes[0]?.code).toBeUndefined();
    const allEvents: Array<{ kind: string }> = [];
    for (let t = 0; t < 60; t++) {
      allEvents.push(...step(state, [], 1, pipeline).events);
    }
    expect(allEvents.some((e) => e.kind === 'tileStateChanged')).toBe(true);

    const r3 = getExtractorRingStats(state, 2, 0, 2, 2, 0, 2);
    expect(r3.terraformedTiles).toBe(r1.terraformedTiles + 1);
  });

  it('ships scenario w05-tiers: ringed Metals Extractor splits 70% metals.t1 / 30% metals.t2 while unterraformed stays 100% metals.t1', () => {
    const { host } = createScenarioPlanet('w05-tiers');
    const v = view(host.state);
    const col = v.colonies[0]!;
    const tf = col.terraform as { percent: number };
    expect(tf.percent).toBeGreaterThanOrEqual(30);

    const prod = col.production as {
      incomePerS: Record<string, number>;
      tierGates: { colonyTerraformPct: number; tier2: { open: boolean } };
      extractors: Record<
        number,
        {
          q: number;
          r: number;
          unlockedTier: number;
          ringTerraformedPct: number;
          shares: { t1Share: number; t2Share: number; t3Share: number };
          incomePerSByKey: Record<string, number>;
        }
      >;
    };
    expect(prod.tierGates.tier2.open).toBe(true);
    expect(prod.incomePerS['metals.t2']).toBeGreaterThan(0);

    const extList = Object.values(prod.extractors);
    expect(extList).toHaveLength(2);

    const ringed = extList.find((e) => e.q === 3 && e.r === 0)!;
    const plain = extList.find((e) => e.q === -5 && e.r === 0)!;
    expect(ringed).toBeDefined();
    expect(plain).toBeDefined();

    expect(ringed.unlockedTier).toBe(2);
    expect(ringed.ringTerraformedPct).toBeGreaterThanOrEqual(50);
    expect(ringed.shares).toEqual({ t1Share: 0.7, t2Share: 0.3, t3Share: 0 });
    const ringedTotal = (ringed.incomePerSByKey['metals.t1'] ?? 0) + (ringed.incomePerSByKey['metals.t2'] ?? 0);
    expect((ringed.incomePerSByKey['metals.t1'] ?? 0) / ringedTotal).toBeCloseTo(0.7, 3);
    expect((ringed.incomePerSByKey['metals.t2'] ?? 0) / ringedTotal).toBeCloseTo(0.3, 3);

    expect(plain.unlockedTier).toBe(1);
    expect(plain.ringTerraformedPct).toBe(0);
    expect(plain.shares).toEqual({ t1Share: 1, t2Share: 0, t3Share: 0 });
    expect(plain.incomePerSByKey['metals.t1']).toBeGreaterThan(0);
    expect(plain.incomePerSByKey['metals.t2'] ?? 0).toBe(0);
  });
});

describe('W05-34 each gate reads the ring of its own radius (D-35 tuning)', () => {
  it('a tuned tier3Gate.ringRadius 1 opens T3 on a Living inner ring even when the radius-2 ring is mostly bare', () => {
    const { state } = setupFlatColonyState(0);
    const idx = hexIndex(state.grid.radius);
    const foot: Array<[number, number]> = [[2, 0], [3, 0], [2, 1], [3, 1]];
    for (let i = 0; i < state.grid.count; i++) {
      const d = Math.min(...foot.map(([q, r]) => hexDistance(idx.q[i]!, idx.r[i]!, q, r)));
      setTilePrep(state, i, d === 1 ? PREP.living : PREP.flat, 0);
    }
    const base = compileData(parseWaves('..05'));
    const tuned = compileData(parseWaves('..05'), { terraform: { tier3Gate: { ringRadius: 1 } } });
    const atBase = evaluateExtractorTierGate(state, 0, 2, 0, 2, 2, 0, base, 100);
    expect(atBase.ring.livingRatio).toBeLessThan(0.5);
    expect(atBase.unlockedTier).toBe(1);
    const atTuned = evaluateExtractorTierGate(state, 0, 2, 0, 2, 2, 0, tuned, 100);
    expect(atTuned.ringT3Open).toBe(true);
    expect(atTuned.unlockedTier).toBe(3);
    expect(atTuned.shares).toEqual({ t1Share: 0.5, t2Share: 0.3, t3Share: 0.2 });
  });
});
