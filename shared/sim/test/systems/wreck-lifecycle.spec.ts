import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  buildPipeline,
  cancelBuildingConstruction,
  createPlanet,
  DEPOSIT,
  demolishBuilding,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluateGroundWorkTile,
  evaluatePlacement,
  findHexPath,
  getFootprintTileIndices,
  getWrecksMap,
  getWreckTileSet,
  hexIndex,
  insertRow,
  pathBlockersFor,
  placeMetalsExtractor,
  placeSpawnedEntity,
  placementWorldFromState,
  planGroundWorkTiles,
  PREP,
  setColonyStock,
  setTileDeposit,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  spawnWorkerUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
  terraformWorldFromState,
} from '../../src';

function createBootedCombatHost(waves = '..07', seed = 'wreck-lifecycle-spec') {
  const host = new SimHost(buildPipeline(parseWaves(waves).list, {}));
  host.load(createPlanet({ id: 'p_wreck', seed, type: 'flat', planetType: 'temperate', radius: 14 }));
  const idx = hexIndex(host.state.grid.radius);
  for (let i = 0; i < idx.count; i++) {
    setTileTerrain(host.state.grid, i, TERRAIN.flat, 0);
    setTilePrep(host.state.grid, i, PREP.prepared, 0);
  }
  host.state.colonies.push({ index: 0, id: 'col_0', name: 'Alpha', color: 0xff6b00, status: 'active', changedAt: 0 });
  host.state.colonies.push({ index: 1, id: 'col_1', name: 'Beta', color: 0x00aaff, status: 'active', changedAt: 0 });
  for (let i = 0; i < idx.count; i++) {
    if (idx.q[i]! <= 6) setTileOwner(host.state.grid, i, 0, 0);
    else setTileOwner(host.state.grid, i, 1, 0);
  }
  setColonyStock(host.state, 0, { 'metals.t1': 2000, 'minerals.t1': 2000, 'bio.biomass': 2000, 'bio.water': 2000 });
  setColonyStock(host.state, 1, { 'metals.t1': 2000, 'minerals.t1': 2000, 'bio.biomass': 2000, 'bio.water': 2000 });
  const hq = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  return { host, idx, hq };
}

function spawnTankAt(host: SimHost, owner: number, q: number, r: number, hp = 40): number {
  const id = host.state.meta.nextEntityId++;
  const row = insertRow(host.state.entities, id, host.tick);
  const cols = host.state.entities.cols;
  cols.kind[row] = ENTITY_KIND.demoTank;
  cols.owner[row] = owner;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(host.state.entities, row, q, r, host.tick);
  return id;
}

describe('Wreck lifecycle: impassable wrecks, exact hex placement, adjacent shard passability, and terraform clearing', () => {
  it('destroying a unit leaves a wreck on its exact hex that blocks ground & hover pathing until terraformed, while neighboring hexes stay passable', () => {
    const { host, idx } = createBootedCombatHost();
    const state = host.state;
    const workerId = spawnWorkerUnit(state, { owner: 0, q: -1, r: 0 });
    const tankId = spawnTankAt(host, 1, 2, 0, 25);

    // Block flanking corridor except around (2, 0) so we can verify (2, 0) is blocked while (2, 1) next to it stays passable
    const res = applyDamage(state, tankId, 50, { attackerOwner: 0 });
    expect(res.destroyed).toBe(true);

    const deadTile = idx.indexOf(2, 0);
    const nearbyTile = idx.indexOf(2, 1);
    expect(getWrecksMap(state)[String(tankId)]).toMatchObject({ id: tankId, q: 2, r: 0, tiles: [deadTile] });
    expect(getWreckTileSet(state).has(deadTile)).toBe(true);
    expect(getWreckTileSet(state).has(nearbyTile)).toBe(false);

    // Ground, terraform, worker, and hover profiles all refuse stepping onto or ending at the wreck hex, while neighbor stays passable
    for (const profile of ['ground', 'terraform', 'worker', 'hover'] as const) {
      const blockers = pathBlockersFor(state, profile, idx.indexOf(0, 0))!;
      expect(blockers.blocked(deadTile), `${profile} blocked on wreck`).toBe(true);
      expect(blockers.goalBlocked(deadTile), `${profile} goalBlocked on wreck`).toBe(true);
      expect(blockers.blocked(nearbyTile), `${profile} passable beside wreck`).toBe(false);
    }

    // Direct path onto wreck tile fails (`ok: false`); path from (1,0) to (3,0) routes around (2,0) via adjacent passable tile, never through (2,0)
    const groundB = pathBlockersFor(state, 'ground', idx.indexOf(1, 0))!;
    expect(findHexPath(state.grid, { q: 1, r: 0 }, { q: 2, r: 0 }, groundB).ok).toBe(false);
    const detour = findHexPath(state.grid, { q: 1, r: 0 }, { q: 3, r: 0 }, groundB);
    expect(detour.ok).toBe(true);
    for (const pt of detour.path) {
      expect([pt.q, pt.r]).not.toEqual([2, 0]);
    }
    expect(findHexPath(state.grid, { q: 1, r: 0 }, { q: 2, r: 1 }, groundB).ok).toBe(true);

    // Real locomotion command respects wreck blockage and reroutes cleanly to nearby passable hexes
    const scoutId = spawnTankAt(host, 0, 1, 0, 40);
    host.submit({
      commandId: 'mv-nearby',
      colonyIndex: 0,
      source: 'player',
      kind: 'moveUnit',
      args: { entityId: scoutId, q: 2, r: 1 },
    });
    for (let t = 0; t < 40; t++) host.step(1);
    const sRow = state.entities.cols.id.indexOf(scoutId);
    expect([state.entities.cols.q[sRow], state.entities.cols.r[sRow]]).toEqual([2, 1]);

    // Building placement on the wreck hex fails with block: 'wreck' even on PREPARED terrain
    expect(evaluatePlacement(placementWorldFromState(state), { colonyId: 0, building: 'pylon', q: 2, r: 0, requireBuilder: false })).toMatchObject({
      ok: false,
      code: 'terrain_unbuildable',
      block: 'wreck',
    });

    // Worker terraforms the wreck away -> tile becomes passable and buildable again
    expect(evaluateGroundWorkTile(terraformWorldFromState(state, 0), 0, deadTile, 2, 0)).toMatchObject({
      ok: true,
      terrainKey: 'wreck',
    });
    host.submit({
      commandId: 'tf-wreck-unit',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 2, r: 0 }], workerId } },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 250 && getWreckTileSet(state).has(deadTile); t++) host.step(1);

    expect(getWreckTileSet(state).has(deadTile)).toBe(false);
    expect(getWrecksMap(state)[String(tankId)]).toBeUndefined();
    const afterB = pathBlockersFor(state, 'ground', idx.indexOf(1, 0))!;
    expect(afterB.blocked(deadTile)).toBe(false);
    expect(findHexPath(state.grid, { q: 1, r: 0 }, { q: 2, r: 0 }, afterB).ok).toBe(true);
  });
});

describe('Building wrecks, exclusions, and frontier wrecks', () => {
  it('destroying a multi-tile building blocks its full footprint until terraformed and preserves extractor deposits underneath', () => {
    const { host, idx } = createBootedCombatHost();
    const state = host.state;
    spawnWorkerUnit(state, { owner: 0, q: 1, r: 0 });
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {} });

    const depTile = idx.indexOf(4, 2);
    setTileDeposit(state, depTile, DEPOSIT.metals, 12000, 0);
    const ext = placeMetalsExtractor(state, { owner: 0, q: 3, r: 2 });
    expect(ext.ok).toBe(true);
    if (!ext.ok) throw new Error('expected extractor');

    const fp = getFootprintTileIndices(state, 3, 2, 2, 2, 0).indices;
    expect(fp).toHaveLength(4);
    applyDamage(state, ext.entityId, 5000, { attackerOwner: 1 });

    // Every tile in the 2x2 building wreck is impassable & unbuildable (even though deposit sits on one tile)
    for (const ti of fp) {
      expect(getWreckTileSet(state).has(ti)).toBe(true);
      expect(pathBlockersFor(state, 'ground', idx.indexOf(0, 0))!.blocked(ti)).toBe(true);
    }
    expect(evaluatePlacement(placementWorldFromState(state), { colonyId: 0, building: 'metalsExtractor', q: 3, r: 2, requireBuilder: false })).toMatchObject({
      ok: false,
      block: 'wreck',
    });

    // Hover/plan across multiple tiles of the same 2x2 wreck coalesces to 1 job instead of queueing duplicates
    const plan = planGroundWorkTiles(terraformWorldFromState(state, 0), [{ q: 3, r: 2 }, { q: 4, r: 2 }], { colonyId: 0, deposit: state.grid.layers.deposit });
    expect(plan.jobs).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toBe('already_queued');

    // Foreign colony cannot terraform colony 0's wreck; colony 0 CAN terraform its destroyed extractor even over the deposit
    expect(evaluateGroundWorkTile(terraformWorldFromState(state, 1), 1, depTile, 4, 2, { deposit: state.grid.layers.deposit })).toEqual({
      ok: false,
      reason: 'not_own_territory',
    });
    expect(evaluateGroundWorkTile(terraformWorldFromState(state, 0), 0, depTile, 4, 2, { deposit: state.grid.layers.deposit })).toMatchObject({
      ok: true,
      terrainKey: 'wreck',
    });

    host.submit({
      commandId: 'tf-wreck-ext',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 4, r: 2 }] } },
    });
    for (let t = 0; t < 250 && getWreckTileSet(state).has(depTile); t++) host.step(1);

    // Whole 2x2 wreck cleared, deposit + richness preserved, and new extractor can immediately rebuild there!
    for (const ti of fp) expect(getWreckTileSet(state).has(ti)).toBe(false);
    expect(state.grid.layers.deposit[depTile]).toBe(DEPOSIT.metals);
    expect(state.grid.layers.richness[depTile]).toBe(12000);
    expect(evaluatePlacement(placementWorldFromState(state), { colonyId: 0, building: 'metalsExtractor', q: 3, r: 2, requireBuilder: false }).ok).toBe(true);
  });
});

describe('Wreck exclusions & neutral frontier wrecks', () => {
  it('does not leave wrecks on fauna kills, player demolish, or build cancellation', () => {
    const { host } = createBootedCombatHost();
    const state = host.state;
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {} });

    const solarActive = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 3, r: -1, instant: true, costOverride: {} });
    if (!solarActive.ok) throw new Error('expected active solar');
    expect(demolishBuilding(state, solarActive.entityId, 0).ok).toBe(true);
    expect(getWreckTileSet(state).size).toBe(0);

    const solarSite = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 3, r: -1, instant: false, costOverride: {} });
    if (!solarSite.ok) throw new Error('expected solar site');
    expect(cancelBuildingConstruction(state, solarSite.entityId, 0).ok).toBe(true);
    expect(getWreckTileSet(state).size).toBe(0);

    const antId = state.meta.nextEntityId++;
    const antRow = insertRow(state.entities, antId, host.tick);
    state.entities.cols.kind[antRow] = ENTITY_KIND.blackAnt;
    state.entities.cols.owner[antRow] = -1;
    state.entities.cols.hp[antRow] = 20;
    state.entities.cols.hpMax[antRow] = 20;
    placeSpawnedEntity(state.entities, antRow, 5, 0, host.tick);
    applyDamage(state, antId, 50, { attackerOwner: 0 });
    expect(getWreckTileSet(state).size).toBe(0);
  });

  it('allows terraforming neutral-territory wrecks left behind by frontier combat', () => {
    const { host, idx } = createBootedCombatHost('..07', 'wreck-neutral');
    const state = host.state;
    spawnWorkerUnit(state, { owner: 0, q: -1, r: 0 });
    const neutralTile = idx.indexOf(2, 0);
    setTileOwner(state.grid, neutralTile, -1, 0);
    const botId = spawnTankAt(host, 1, 2, 0, 20);
    applyDamage(state, botId, 40, { attackerOwner: 0 });

    expect(getWreckTileSet(state).has(neutralTile)).toBe(true);
    expect(evaluateGroundWorkTile(terraformWorldFromState(state, 0), 0, neutralTile, 2, 0)).toMatchObject({
      ok: true,
      terrainKey: 'wreck',
    });
    step(state, [], 1, buildPipeline(parseWaves('..07').list, {}));
  });
});
