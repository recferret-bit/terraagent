import { parseWaves } from '@terra/contracts';
import {
  applyDamage,
  compileData,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluatePlacement,
  findHexPath,
  findTerritoryObstacleToClear,
  getWrecksMap,
  getWreckTileSet,
  hexIndex,
  insertRow,
  isGroundPassable,
  pathBlockedFor,
  placeMetalsExtractor,
  placementWorldFromState,
  placeSpawnedEntity,
  PREP,
  recordMechanicalWreck,
  resolvePassableRaidApproachTile,
  revealAroundChanged,
  revealSubsurface,
  rowOf,
  setTileDeposit,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnTerraformDeposit,
  spawnWorkerUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
} from '../../src';
import { buildingSiteBlock } from '../../src/systems/economy/siteTerrain';
import { destroyHazardEntity } from '../../src/systems/weather/types';
import { describe, expect, it } from 'vitest';

const W05_FLAGS = parseWaves('..05');
const DATA = compileData(W05_FLAGS);

function makeSim(radius = 8) {
  const state = createState({ planetId: 'edge-sim', planetType: 'temperate', seed: 'wreck-edge', radius });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'c0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  colony.stock['metals.t1'] = 2000;
  colony.stock['minerals.t1'] = 2000;
  colony.stock['bio.biomass'] = 2000;
  colony.stock['bio.water'] = 2000;
  const idx = hexIndex(state.grid.radius);
  for (let r = -6; r <= 6; r++) {
    for (let q = -6; q <= 6; q++) {
      const ti = idx.indexOf(q, r);
      if (ti >= 0) {
        setTileOwner(state, ti, 0, 0);
        setTilePrep(state, ti, PREP.prepared, 0);
      }
    }
  }
  return { state, colony, idx };
}

describe('Subsurface & terraform deposit blocking', () => {
  it('refuses revealSubsurface, revealAroundChanged, and spawnTerraformDeposit under buildings or active wrecks, then reveals after wreck terraform clear', () => {
    const { state, idx } = makeSim(8);
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 4, instant: true, data: DATA }).ok).toBe(true);

    // Plant subsurface metals under three tiles:
    // (1, 0): active building (wind); (3, 0): constructing building (solar); (1, 2): active wreck
    const sub = new Uint8Array(state.grid.layers.deposit.length);
    const subRich = new Float32Array(state.grid.layers.deposit.length);
    state.grid.layers.subDeposit = sub;
    state.grid.layers.subRichness = subRich;

    const bldgTile = idx.indexOf(1, 0);
    const consTile = idx.indexOf(3, 0);
    const wreckTile = idx.indexOf(1, 2);
    for (const ti of [bldgTile, consTile, wreckTile]) {
      sub[ti] = DEPOSIT.metals;
      subRich[ti] = 10000;
    }

    expect(startBuildingConstruction(state, { owner: 0, building: 'wind', q: 1, r: 0, instant: true, data: DATA }).ok).toBe(true);
    expect(startBuildingConstruction(state, { owner: 0, building: 'solar', q: 3, r: 0, instant: false, data: DATA }).ok).toBe(true);
    recordMechanicalWreck(
      state,
      {
        id: 9001,
        kind: ENTITY_KIND.demoTank,
        owner: 0,
        q: 1,
        r: 2,
        tiles: [wreckTile],
      },
      1,
    );

    // Direct revealSubsurface and revealAroundChanged must skip all 3 tiles
    expect(revealSubsurface(state, bldgTile, 2)).toBeNull();
    expect(revealSubsurface(state, consTile, 2)).toBeNull();
    expect(revealSubsurface(state, wreckTile, 2)).toBeNull();
    expect(revealAroundChanged(state, [bldgTile], 2)).toEqual([]);
    expect(revealAroundChanged(state, [consTile], 2)).toEqual([]);
    expect(revealAroundChanged(state, [wreckTile], 2)).toEqual([]);

    // spawnTerraformDeposit must also refuse occupied & wreck tiles
    const rng = 0.25;
    const tfCtx = {
      tick: 2,
      dt: 1,
      flags: W05_FLAGS,
      data: DATA,
      rng: () => rng,
      emit: () => {},
      newEntityId: () => state.meta.nextEntityId++,
    } as unknown as Parameters<typeof spawnTerraformDeposit>[3];
    expect(spawnTerraformDeposit(state, { tileIdx: bldgTile, q: 1, r: 0 }, { colonyId: 'c0' }, tfCtx, () => rng)).toBeNull();
    expect(spawnTerraformDeposit(state, { tileIdx: consTile, q: 3, r: 0 }, { colonyId: 'c0' }, tfCtx, () => rng)).toBeNull();
    expect(spawnTerraformDeposit(state, { tileIdx: wreckTile, q: 1, r: 2 }, { colonyId: 'c0' }, tfCtx, () => rng)).toBeNull();

    expect(state.grid.layers.deposit[bldgTile]).toBe(DEPOSIT.none);
    expect(state.grid.layers.deposit[consTile]).toBe(DEPOSIT.none);
    expect(state.grid.layers.deposit[wreckTile]).toBe(DEPOSIT.none);

    // Clear the wreck via terraform work -> revealSubsurface now reveals the buried deposit on (1, 2)!
    const workerId = spawnWorkerUnit(state, { owner: 0, q: 0, r: 2 });
    const pipeline = createRegistryPipeline({ flags: W05_FLAGS });
    const res = step(
      state,
      [{
        commandId: 'tf-wreck-rev',
        colonyIndex: 0,
        source: 'player',
        kind: 'enqueueTask',
        args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 1, r: 2 }], workerId } },
      }],
      1,
      pipeline,
    );
    expect(res.outcomes[0]!.code).toBeUndefined();
    step(state, [], 65, pipeline);
    expect(getWreckTileSet(state).has(wreckTile)).toBe(false);
    // After clearing, revealSubsurface succeeds
    if (state.grid.layers.deposit[wreckTile] === DEPOSIT.none) {
      expect(revealSubsurface(state, wreckTile, state.meta.tick)?.deposit).toBe('metals');
    }
    expect(state.grid.layers.deposit[wreckTile]).toBe(DEPOSIT.metals);
  });
});

describe('SiteTerrain fallback & raid/AI wreck handling', () => {
  it('buildingSiteBlock rejects both deposits and active wrecks even in fallback path', () => {
    const { state, idx } = makeSim(6);
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 4, instant: true, data: DATA }).ok).toBe(true);
    const depTile = idx.indexOf(2, 0);
    setTileDeposit(state, depTile, DEPOSIT.metals, 0, 0); // depleted deposit!
    expect(buildingSiteBlock(state, { owner: 0, building: 'wind', q: 2, r: 0 }, [depTile], DATA)).toEqual({
      code: 'terrain_unbuildable',
      detail: 'resource deposit',
    });

    const wreckTile = idx.indexOf(0, 0);
    recordMechanicalWreck(state, { id: 9002, kind: ENTITY_KIND.demoTank, owner: 0, q: 0, r: 0, tiles: [wreckTile] }, 1);
    expect(buildingSiteBlock(state, { owner: 0, building: 'wind', q: 0, r: 0 }, [wreckTile], DATA)).toEqual({
      code: 'terrain_unbuildable',
      detail: 'wreckage: terraform to clear',
    });
  });

  it('raidPathing avoids wreck tiles while keeping adjacent neighbors passable, and aiTerritory detects wrecks to clear', () => {
    const { state, idx } = makeSim(8);
    // Place wreck at (2, 0) and verify raid approach from (0, 0) toward (2, 0) stops on an adjacent passable tile, never (2, 0)
    const wTile = idx.indexOf(2, 0);
    recordMechanicalWreck(state, { id: 9003, kind: ENTITY_KIND.demoTank, owner: 0, q: 2, r: 0, tiles: [wTile] }, 1);
    expect(isGroundPassable(state.grid, wTile, DATA)).toBe(true); // base grid terrain unchanged
    expect(getWreckTileSet(state).has(wTile)).toBe(true);

    const approach = resolvePassableRaidApproachTile(state, 0, 0, 2, 0, DATA);
    expect(approach).not.toBeNull();
    expect(idx.indexOf(approach!.q, approach!.r)).not.toBe(wTile);

    // aiTerritory obstacle detector finds the wreck inside colony 0's territory
    const obstacle = findTerritoryObstacleToClear(state, 0, {
      maxRadius: 6,
      data: DATA,
    });
    expect(obstacle).toMatchObject({ q: 2, r: 0, terrainKey: 'wreck' });
  });
});

describe('Neutral & slope wreck clearing via terraform', () => {
  it('end-to-end terraform worker clears neutral-territory wrecks AND wrecks on slope/wild terrain without looping', () => {
    const { state, idx } = makeSim(8);
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: -4, r: 0, instant: true, data: DATA }).ok).toBe(true);

    // Neutral territory (owner = -1) wreck at (2, -1) on flat prepared ground
    const neutralTile = idx.indexOf(2, -1);
    setTileOwner(state, neutralTile, -1, 0);
    recordMechanicalWreck(state, { id: 9004, kind: ENTITY_KIND.recon, owner: 1, q: 2, r: -1, tiles: [neutralTile] }, 1);

    // Own territory wreck on TERRAIN.slope + PREP.wild at (2, 2)
    const slopeTile = idx.indexOf(2, 2);
    setTileTerrain(state, slopeTile, TERRAIN.slope, 0);
    setTilePrep(state, slopeTile, PREP.wild, 0);
    recordMechanicalWreck(state, { id: 9005, kind: ENTITY_KIND.demoTank, owner: 1, q: 2, r: 2, tiles: [slopeTile] }, 1);

    const w1 = spawnWorkerUnit(state, { owner: 0, q: 1, r: -1 });
    const w2 = spawnWorkerUnit(state, { owner: 0, q: 1, r: 2 });
    const pipeline = createRegistryPipeline({ flags: W05_FLAGS });

    const r1 = step(
      state,
      [
        {
          commandId: 'tf-neutral',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 2, r: -1 }], workerId: w1 } },
        },
        {
          commandId: 'tf-slope',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 2, r: 2 }], workerId: w2 } },
        },
      ],
      1,
      pipeline,
    );
    expect(r1.outcomes[0]!.code).toBeUndefined();
    expect(r1.outcomes[1]!.code).toBeUndefined();

    step(state, [], 65, pipeline);

    expect(getWrecksMap(state)[9004]).toBeUndefined();
    expect(getWrecksMap(state)[9005]).toBeUndefined();
    expect(getWreckTileSet(state).has(neutralTile)).toBe(false);
    expect(getWreckTileSet(state).has(slopeTile)).toBe(false);
    // Clearing a slope wreck removes the wreck cleanly without crashing or looping; a second terraform flattens the slope
    const flatten = step(
      state,
      [{
        commandId: 'tf-slope-flatten',
        colonyIndex: 0,
        source: 'player',
        kind: 'enqueueTask',
        args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 2, r: 2 }], workerId: w2 } },
      }],
      1,
      pipeline,
    );
    expect(flatten.outcomes[0]!.code).toBeUndefined();
    step(state, [], 420, pipeline);
    expect(state.grid.layers.prep[slopeTile]).toBe(PREP.prepared);
  });
});

describe('2x2 building wreck deposit preservation', () => {
  it('preserves deposit under a 2x2 building wreck, blocks new extractor until terraformed, and allows metalsExtractor again once cleared', () => {
    const { state, idx } = makeSim(8);
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 4, instant: true, data: DATA }).ok).toBe(true);
    const fp = [idx.indexOf(1, 0), idx.indexOf(2, 0), idx.indexOf(1, 1), idx.indexOf(2, 1)];
    setTileDeposit(state, fp[0]!, DEPOSIT.metals, 9000, 0);
    recordMechanicalWreck(state, { id: 9006, kind: ENTITY_KIND.metalsExtractor, owner: 0, q: 1, r: 0, tiles: fp }, 1);

    // Blocked while wreck remains
    const blocked = evaluatePlacement(placementWorldFromState(state), { colonyId: 0, building: 'metalsExtractor', q: 1, r: 0, requireBuilder: false, data: DATA });
    expect(blocked.ok).toBe(false);
    expect(blocked.text).toContain('wreck');

    const w = spawnWorkerUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: W05_FLAGS });
    const tf = step(
      state,
      [{
        commandId: 'tf-bldg-wreck',
        colonyIndex: 0,
        source: 'player',
        kind: 'enqueueTask',
        args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 1, r: 0 }], workerId: w } },
      }],
      1,
      pipeline,
    );
    expect(tf.outcomes[0]!.code).toBeUndefined();
    step(state, [], 65, pipeline);

    // Full 2x2 building wreck cleared from one tile click, deposit preserved, extractor allowed again!
    expect(getWrecksMap(state)[9006]).toBeUndefined();
    expect(state.grid.layers.deposit[fp[0]!]).toBe(DEPOSIT.metals);
    const allowed = evaluatePlacement(placementWorldFromState(state), { colonyId: 0, building: 'metalsExtractor', q: 1, r: 0, requireBuilder: false, data: DATA });
    expect(allowed.ok).toBe(true);
  });
});

describe('Combat destruction & pathing around wrecks', () => {
  it('combat applyDamage destroys 2x2 building and moving tank, blocking exact pre-death hexes while keeping adjacent neighbors passable', () => {
    const { state, idx } = makeSim(8);
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 4, instant: true, data: DATA }).ok).toBe(true);
    const extTiles = [idx.indexOf(1, 0), idx.indexOf(2, 0), idx.indexOf(1, 1), idx.indexOf(2, 1)];
    setTileDeposit(state, extTiles[0]!, DEPOSIT.metals, 10000, 0);
    const ext = placeMetalsExtractor(state, { owner: 0, q: 1, r: 0, completed: true, data: DATA });
    expect(ext.ok).toBe(true);
    if (!ext.ok) return;

    const tankId = state.meta.nextEntityId++;
    const tRow = insertRow(state.entities, tankId, 1);
    const cols = state.entities.cols;
    cols.kind[tRow] = ENTITY_KIND.demoTank;
    cols.owner[tRow] = 0;
    cols.hp[tRow] = 200;
    cols.hpMax[tRow] = 200;
    cols.state[tRow] = ENTITY_STATE.moving;
    placeSpawnedEntity(state.entities, tRow, -2, 0, 1);
    // Simulate continuous sub-hex motion offset while still anchored on (-2, 0)
    cols.x[tRow] += 0.6;
    cols.y[tRow] -= 0.4;

    applyDamage(state, ext.entityId, 99999, { tick: 5, data: DATA });
    applyDamage(state, tankId, 99999, { tick: 5, data: DATA });

    const wrecks = getWrecksMap(state);
    expect(wrecks[ext.entityId]).toMatchObject({ id: ext.entityId, q: 1, r: 0, tiles: extTiles });
    expect(wrecks[tankId]).toMatchObject({ id: tankId, q: -2, r: 0, tiles: [idx.indexOf(-2, 0)] });

    const blocked = pathBlockedFor(state, 'ground', -1, DATA)!;
    for (const ti of extTiles) expect(blocked(ti)).toBe(true);
    expect(blocked(idx.indexOf(-2, 0))).toBe(true);

    // Adjacent neighboring hexes (potential visual peripheral debris zones) stay completely passable
    for (const [nq, nr] of [[0, 0], [3, 0], [1, -1], [-1, 0], [-2, -1], [-3, 0]] as const) {
      expect(blocked(idx.indexOf(nq, nr))).toBe(false);
    }

    // Ground pathfinding routes cleanly around both wrecks
    const path = findHexPath(state.grid, { q: -3, r: 0 }, { q: 3, r: 0 }, { blocked, data: DATA });
    expect(path.ok).toBe(true);
    for (const stepHex of path.path) {
      expect(blocked(idx.indexOf(stepHex.q, stepHex.r))).toBe(false);
    }
    expect(rowOf(state.entities, tankId)).toBe(-1);
  });
});

describe('Dev damage & weather hazard wreck recording', () => {
  it('non-W07 dev.damage at 100% and weather destroyHazardEntity both record impassable mechanical wrecks', () => {
    const { state, idx } = makeSim(8);
    const w03Flags = parseWaves('..03');
    const w03Data = compileData(w03Flags);
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 4, instant: true, data: w03Data }).ok).toBe(true);
    const windRes = startBuildingConstruction(state, { owner: 0, building: 'wind', q: 2, r: 0, instant: true, data: w03Data });
    expect(windRes.ok).toBe(true);
    if (!windRes.ok) return;

    // 1) Non-W07 dev.damage 100% keeps hp=0 row while recording an impassable wreck in blobs.wrecks
    const pipelineW03 = createRegistryPipeline({ flags: w03Flags });
    const dmgRes = step(
      state,
      [{ commandId: 'dev-dmg-w03', colonyIndex: 0, source: 'dev', kind: 'dev.damage', args: { entityId: windRes.entityId, pct: 100 } }],
      1,
      pipelineW03,
    );
    expect(dmgRes.outcomes[0]!.code).toBeUndefined();
    expect(state.entities.cols.hp[rowOf(state.entities, windRes.entityId)]).toBe(0);
    expect(getWrecksMap(state)[windRes.entityId]).toMatchObject({ id: windRes.entityId, q: 2, r: 0 });
    expect(getWreckTileSet(state).has(idx.indexOf(2, 0))).toBe(true);

    // 2) Hazard destruction (e.g. twister) records a mechanical wreck at exact unit/building hexes
    const workerId = spawnWorkerUnit(state, { owner: 0, q: -1, r: 0 });
    expect(destroyHazardEntity(state, workerId, 10, DATA)).toBe(true);
    expect(rowOf(state.entities, workerId)).toBe(-1);
    expect(getWrecksMap(state)[workerId]).toMatchObject({ id: workerId, q: -1, r: 0, tiles: [idx.indexOf(-1, 0)] });
    expect(getWreckTileSet(state).has(idx.indexOf(-1, 0))).toBe(true);
  });
});
