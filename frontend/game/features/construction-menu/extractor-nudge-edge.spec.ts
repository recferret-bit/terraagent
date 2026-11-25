// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluatePlacement,
  hexCount,
  hexIndex,
  placementWorldFromState,
  PREP,
  setTileDeposit,
  setTileOwner,
  setTilePrep,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
  type ViewEntity,
} from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { ConstructionMenu } from './ConstructionMenu';
import { evaluatePlacementGhost } from './PlacementGhost';

const W03_FLAGS = new Set(['W00', 'W01', 'W02', 'W03', 'W05']);

function makeGhostView(radius = 8, includeRichness = true) {
  const count = hexCount(radius);
  const terrain = new Uint8Array(count).fill(TERRAIN.flat);
  const prep = new Uint8Array(count).fill(PREP.prepared);
  const deposit = new Uint8Array(count);
  const richness = new Float32Array(count);
  const height = new Float32Array(count);
  const owner = new Int8Array(count).fill(0);
  const hIndex = hexIndex(radius);

  const hubEntity = {
    id: 1,
    kind: ENTITY_KIND.commandHub,
    owner: 0,
    q: 0,
    r: -4,
    hp: 1500,
    hpMax: 1500,
    state: ENTITY_STATE.idle,
  } as unknown as ViewEntity;

  const tilesObj: Record<string, unknown> = { count, terrain, prep, deposit, height, owner };
  if (includeRichness) tilesObj.richness = richness;

  const view = {
    planet: { id: 'edge-test', type: 'temperate' as const, radius },
    tiles: tilesObj,
    entities: [hubEntity],
    count: 1,
    colonies: [{ index: 0, stock: { 'metals.t1': 500, 'minerals.t1': 500, 'bio.water': 500, 'bio.biomass': 500 } }],
  } as unknown as GameView;

  return {
    view,
    hIndex,
    setTile(q: number, r: number, patch: { deposit?: number; richness?: number; terrain?: number; prep?: number; owner?: number }) {
      const i = hIndex.indexOf(q, r);
      if (i < 0) return;
      if (patch.deposit !== undefined) deposit[i] = patch.deposit;
      if (patch.richness !== undefined) richness[i] = patch.richness;
      if (patch.terrain !== undefined) terrain[i] = patch.terrain;
      if (patch.prep !== undefined) prep[i] = patch.prep;
      if (patch.owner !== undefined) owner[i] = patch.owner;
    },
  };
}

describe('Extractor nudge & mixed-deposit rejection', () => {
  it('nudges metalsExtractor off a mixed metals+minerals hover onto an adjacent valid metals-only footprint, and stays blocked when all valid offsets are mixed', () => {
    const { view, setTile } = makeGhostView(8);
    // Single metals at (1, 0), adjacent minerals at (2, 0).
    // Hovering (1, 0): un-nudged 2x2 {(1,0),(2,0),(1,1),(2,1)} mixes metals+minerals,
    // whereas nudged anchor (0, 0) covers {(0,0),(1,0),(0,1),(1,1)} -> valid metals-only!
    setTile(1, 0, { deposit: DEPOSIT.metals, richness: 10000 });
    setTile(2, 0, { deposit: DEPOSIT.minerals, richness: 10000 });

    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const ctx = {
      flags: W03_FLAGS,
      host: 'server' as const,
      services: { sendCommand, track: vi.fn() },
    } as unknown as FeatureContext;

    const menu = new ConstructionMenu(document.createElement('div'), ctx, view);
    menu.startPlacement('metalsExtractor');
    menu.setHoverTile(1, 0);
    const nudged = menu.getGhostState()!;
    expect(nudged.valid).toBe(true);
    expect([nudged.q, nudged.r]).toEqual([0, 0]);
    expect(nudged.tiles.some((t) => t.q === 1 && t.r === 0)).toBe(true);
    expect(nudged.tiles.some((t) => t.q === 2 && t.r === 0)).toBe(false);

    // Surround (1, 0) symmetrically with minerals so NO 2x2 containing (1, 0) avoids minerals:
    // Every 2x2 containing (1,0) must include either (0,0) or (2,0) AND either (1,-1) or (1,1).
    // Putting minerals on (0,0) and (2,0) forces EVERY 2x2 containing (1,0) to mix metals+minerals!
    setTile(0, 0, { deposit: DEPOSIT.minerals, richness: 10000 });
    menu.setHoverTile(1, 0);
    const impossible = menu.getGhostState()!;
    expect(impossible.valid).toBe(false);
    expect(menu.confirm()).toBe(false);
    expect(sendCommand).not.toHaveBeenCalled();

    menu.dispose();
  });
});

describe('Depleted deposit blocking on ghost', () => {
  it('rejects non-extractor buildings (wind, solar, waterExtractor, commandHub, supplyDepot) on both active AND depleted deposits', () => {
    const { view, setTile } = makeGhostView(8, true);
    // (1, 1): active metals deposit; (3, 1): depleted metals deposit (deposit=metals, richness=0)
    setTile(1, 1, { deposit: DEPOSIT.metals, richness: 10000 });
    setTile(3, 1, { deposit: DEPOSIT.metals, richness: 0 });
    setTile(-2, 2, { deposit: DEPOSIT.minerals, richness: 0 });
    setTile(0, 3, { deposit: DEPOSIT.oil, richness: 0 });

    for (const building of ['wind', 'solar', 'waterExtractor', 'supplyDepot', 'commandHub'] as const) {
      const activeHit = evaluatePlacementGhost({ building, q: 1, r: 1, rotation: 0, flags: W03_FLAGS, view });
      expect(activeHit.valid, `${building} on active deposit`).toBe(false);

      const depMetals = evaluatePlacementGhost({ building, q: 3, r: 1, rotation: 0, flags: W03_FLAGS, view });
      expect(depMetals.valid, `${building} on depleted metals`).toBe(false);

      const depMinerals = evaluatePlacementGhost({ building, q: -2, r: 2, rotation: 0, flags: W03_FLAGS, view });
      expect(depMinerals.valid, `${building} on depleted minerals`).toBe(false);

      const depOil = evaluatePlacementGhost({ building, q: 0, r: 3, rotation: 0, flags: W03_FLAGS, view });
      expect(depOil.valid, `${building} on depleted oil`).toBe(false);
    }

    const extOnOil = evaluatePlacementGhost({ building: 'metalsExtractor', q: 0, r: 3, rotation: 0, flags: W03_FLAGS, view });
    expect(extOnOil.valid).toBe(false);
  });
});

describe('Sim mixed-deposit block & minerals extraction', () => {
  it('blocks mixed deposits in sim evaluatePlacement and extracts minerals.t1 cleanly when metalsExtractor is placed on minerals-only', () => {
    const state = createState({ planetId: 'ext-sim', planetType: 'temperate', seed: 'ext-edge', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'c0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);
    colony.stock['metals.t1'] = 500;
    colony.stock['minerals.t1'] = 500;
    colony.stock['bio.biomass'] = 500;
    colony.stock['bio.water'] = 500;

    const idx = hexIndex(state.grid.radius);
    for (let r = -6; r <= 6; r++) {
      for (let q = -6; q <= 6; q++) {
        const ti = idx.indexOf(q, r);
        if (ti < 0) continue;
        setTileOwner(state, ti, 0, 0);
        setTilePrep(state, ti, PREP.prepared, 0);
      }
    }
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 4, instant: true }).ok).toBe(true);
    expect(startBuildingConstruction(state, { owner: 0, building: 'wind', q: -1, r: 0, instant: true }).ok).toBe(true);
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const stockMap = (c: typeof colony) => ensureColonyLedger(c).stock as Record<string, number>;

    // Footprint at (1, 0): (1,0)=minerals, (2,0)=metals -> mixed!
    setTileDeposit(state, idx.indexOf(1, 0), DEPOSIT.minerals, 10000, 0);
    setTileDeposit(state, idx.indexOf(2, 0), DEPOSIT.metals, 10000, 0);
    const mixedEval = evaluatePlacement(placementWorldFromState(state), { colonyId: 0, building: 'metalsExtractor', q: 1, r: 0, requireBuilder: false });
    expect(mixedEval.ok).toBe(false);
    expect(mixedEval.block).toBe('mixedDeposit');

    // Clear (2, 0) deposit -> (1, 0) 2x2 now has ONLY minerals
    setTileDeposit(state, idx.indexOf(2, 0), DEPOSIT.none, 0, 0);
    const pureMineralsEval = evaluatePlacement(placementWorldFromState(state), { colonyId: 0, building: 'metalsExtractor', q: 1, r: 0, requireBuilder: false });
    expect(pureMineralsEval.ok).toBe(true);

    const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
    const buildStep = step(
      state,
      [{ commandId: 'ext-1', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { task: { kind: 'build', building: 'metalsExtractor', q: 1, r: 0 } } }],
      1,
      pipeline,
    );
    expect(buildStep.outcomes[0]!.code).toBeUndefined();

    // Let worker finish construction + run extraction
    step(state, [], 160, pipeline);
    const afterBuildMinerals = stockMap(colony)['minerals.t1'] ?? 0;
    const afterBuildMetals = stockMap(colony)['metals.t1'] ?? 0;
    step(state, [], 40, pipeline);
    expect(stockMap(colony)['minerals.t1'] ?? 0).toBeGreaterThan(afterBuildMinerals);
    expect(stockMap(colony)['metals.t1'] ?? 0).toBe(afterBuildMetals);
  });
});
