import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  assignWorkerDepositTarget,
  claimTerritoryRadius,
  createCombatTestHost,
  createPlanet,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  extractTileChanges,
  findFactoryEdgeSpawnTile,
  findHubEdgeSpawnTile,
  getAllHives,
  getBuildingFootprintTiles,
  hasAnyPassableNeighbor,
  HIVE_PLANAR_RADIUS_DESERT,
  hexDistance,
  hexIndex,
  insertRow,
  isHexTile,
  materializeWorldgenHives,
  pickMinRangeBackoffNeighbor,
  placeSpawnedEntity,
  planBackendBotActions,
  planWorldgenHiveSites,
  PREP,
  recordMechanicalWreck,
  rowOf,
  seedRivalAiColonies,
  setTileDeposit,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHiveSite,
  spawnHqUnit,
  spawnWorkerUnit,
  startBuildingConstruction,
  TERRAIN,
} from '../../src';
import { hivePlanarDist } from '../../src/systems/fauna/hiveGround';

describe('Hive ground spawning: player-radius parity, deposit R2 invariant, and tick-0 diff sync', () => {
  it('matches desert player landing radius (5.2 planar tiles), preserves R2 on every visible deposit, and stamps changedAt at tick 0', () => {
    const data = createRegistryPipeline({ flags: parseWaves('..07') }).config.data;
    const desert = createPlanet({ id: 'd-r2', seed: 'golden-1', type: 'temperate', planetType: 'desert', radius: 56 });
    materializeWorldgenHives(desert, 0, data);

    const L = desert.grid.layers;
    const layers = { terrain: L.terrain, prep: L.prep, height: L.height };
    for (let i = 0; i < desert.grid.count; i++) {
      if (L.deposit[i] !== DEPOSIT.none) {
        expect(isHexTile(desert.grid.radius, i, layers), `deposit tile ${i} stays on hex tile`).toBe(true);
      }
    }
    expect(HIVE_PLANAR_RADIUS_DESERT).toBe(5.2);
    expect(hivePlanarDist(3, 2)).toBeLessThanOrEqual(HIVE_PLANAR_RADIUS_DESERT);

    // Spawning a hive at tick 0 after SimHost.load still stamps changedAt >= 1 so diffSince(0) carries the hex pad
    const host = new SimHost(createRegistryPipeline({ flags: parseWaves('..07') }));
    const s = createState({ planetId: 'tick0-diff', planetType: 'desert', seed: 'tick0', radius: 14 });
    s.grid.layers.terrain.fill(TERRAIN.slope);
    s.grid.layers.prep.fill(PREP.wild);
    s.grid.layers.height.fill(2.4);
    host.load(s);
    spawnHiveSite(s, { species: 'blackAnt', q: 0, r: 0, initialResidents: 1 }, 0, data);
    const tileDiffs = extractTileChanges(host.diffSince(0));
    expect(tileDiffs.length).toBeGreaterThan(40);
  });

  it('allows dev.spawnhive on un-terraformed mountain/hole ground in combat-test mode while blocking dev.spawnunit on mountains', () => {
    const { host } = createCombatTestHost({ planetType: 'desert', seed: 'ct-hive-mtn', botCount: 1 });
    const state = host.state;
    const hx = hexIndex(state.grid.radius);
    const targetQ = 0;
    const targetR = -20;

    // Surround (0, -20) with wild mountains and holes so only terraformHiveGround can make an entrance
    for (let dr = -2; dr <= 2; dr++) {
      for (let dq = -2; dq <= 2; dq++) {
        const ti = hx.indexOf(targetQ + dq, targetR + dr);
        if (ti >= 0) {
          setTileTerrain(state.grid, ti, dq === 0 && dr === 0 ? TERRAIN.rock : TERRAIN.hole, host.tick);
          setTilePrep(state.grid, ti, PREP.wild, host.tick);
          state.grid.layers.owner[ti] = -1;
        }
      }
    }

    // Unit/insect spawn on unprepared mountain must be rejected
    const mtnIdx = hx.indexOf(targetQ, targetR);
    setTileTerrain(state.grid, mtnIdx, TERRAIN.rock, host.tick);
    host.submit({
      commandId: 'ct_unit_mtn',
      colonyIndex: 0,
      source: 'player',
      kind: 'dev.spawnunit',
      args: { unit: 'recon', q: targetQ, r: targetR, owner: 0 },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    // Hive spawn on the same un-terraformed mountain/hole patch succeeds and creates hexagons
    host.submit({
      commandId: 'ct_hive_mtn',
      colonyIndex: 0,
      source: 'player',
      kind: 'dev.spawnhive',
      args: { species: 'blackAnt', q: targetQ, r: targetR, mode: 'passive', initialResidents: 2 },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(state.grid.layers.terrain[mtnIdx]).toBe(TERRAIN.flat);
    expect(isHexTile(state.grid.radius, mtnIdx, {
      terrain: state.grid.layers.terrain,
      prep: state.grid.layers.prep,
      height: state.grid.layers.height,
    })).toBe(true);
  });
});

describe('Dunes vs Mountains: factory/hub rollout, worker harvest stand, and artillery backoff', () => {
  it('keeps factory/hub unit rollouts, worker deposit harvesting, and artillery min-range backoff off mountains and on dunes', () => {
    const data = createRegistryPipeline({ flags: parseWaves('..07') }).config.data;
    const state = createState({ planetId: 'mtn-edges', planetType: 'desert', seed: 'mtn-edges', radius: 14 });
    const hx = hexIndex(state.grid.radius);
    state.grid.layers.terrain.fill(TERRAIN.slope);
    state.grid.layers.prep.fill(PREP.wild);
    setTileHeight(state.grid, 0, 1.0, 0);
    ensureColonyRecord(state, 0, 0);

    // 1. Robotics Factory at (0, 0) with eastern default spawn tile (2, 0) blocked by mountain -> picks dune instead
    const facId = state.meta.nextEntityId++;
    const facRow = insertRow(state.entities, facId, 0);
    state.entities.cols.kind[facRow] = ENTITY_KIND.roboticsFactory;
    state.entities.cols.owner[facRow] = 0;
    state.entities.cols.hp[facRow] = state.entities.cols.hpMax[facRow] = 800;
    state.entities.cols.footprintW[facRow] = state.entities.cols.footprintD[facRow] = 3;
    state.entities.cols.state[facRow] = ENTITY_STATE.active;
    placeSpawnedEntity(state.entities, facRow, 0, 0, 0);

    setTileTerrain(state.grid, hx.indexOf(2, 0), TERRAIN.rock, 0);
    const facSpawn = findFactoryEdgeSpawnTile(state, 0, facId, data);
    expect([facSpawn.q, facSpawn.r]).not.toEqual([2, 0]);
    expect(state.grid.layers.terrain[hx.indexOf(facSpawn.q, facSpawn.r)]).toBe(TERRAIN.slope);

    // 2. Command Hub at (-6, 0) with eastern tile (-4, 0) blocked by mountain -> picks dune instead
    const hubId = state.meta.nextEntityId++;
    const hubRow = insertRow(state.entities, hubId, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.hp[hubRow] = state.entities.cols.hpMax[hubRow] = 1500;
    state.entities.cols.footprintW[hubRow] = state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;
    placeSpawnedEntity(state.entities, hubRow, -6, 0, 0);

    setTileTerrain(state.grid, hx.indexOf(-4, 0), TERRAIN.rock, 0);
    const hubSpawn = findHubEdgeSpawnTile(state, 0, data);
    expect([hubSpawn.q, hubSpawn.r]).not.toEqual([-4, 0]);
    expect(state.grid.layers.terrain[hx.indexOf(hubSpawn.q, hubSpawn.r)]).toBe(TERRAIN.slope);

    // 3. Deposit at (6, 0): 5 neighbors are mountains, only (6, 1) is a non-terraformed dune
    setTileDeposit(state.grid, hx.indexOf(6, 0), DEPOSIT.metals, 10000, 0);
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1]] as const) {
      setTileTerrain(state.grid, hx.indexOf(6 + dq, dr), TERRAIN.rock, 0);
    }
    setTileTerrain(state.grid, hx.indexOf(6, 1), TERRAIN.slope, 0);

    const workerId = spawnWorkerUnit(state, { owner: 0, q: 4, r: 0 });
    const assign = assignWorkerDepositTarget(state, workerId, 6, 0, 0);
    expect(assign).toEqual({ ok: true, standQ: 6, standR: 1 });

    // Sealing the 6th neighbor with mountain makes the deposit unreachable
    setTileTerrain(state.grid, hx.indexOf(6, 1), TERRAIN.rock, 0);
    expect(hasAnyPassableNeighbor(state, 6, 0)).toBe(false);

    // 4. Artillery backoff from close bug skips mountain neighbor and picks non-terraformed dune neighbor
    const artId = state.meta.nextEntityId++;
    const artRow = insertRow(state.entities, artId, 0);
    state.entities.cols.kind[artRow] = ENTITY_KIND.demoArtillery;
    state.entities.cols.owner[artRow] = 0;
    state.entities.cols.hp[artRow] = state.entities.cols.hpMax[artRow] = 320;
    placeSpawnedEntity(state.entities, artRow, 0, 6, 0);

    const bugId = state.meta.nextEntityId++;
    const bugRow = insertRow(state.entities, bugId, 0);
    state.entities.cols.kind[bugRow] = ENTITY_KIND.blackAnt;
    state.entities.cols.owner[bugRow] = -1;
    state.entities.cols.hp[bugRow] = state.entities.cols.hpMax[bugRow] = 85;
    placeSpawnedEntity(state.entities, bugRow, 0, 5, 0);

    // Block (0, 7) and (-1, 7) with mountains; leave (1, 6) as non-terraformed dune
    setTileTerrain(state.grid, hx.indexOf(0, 7), TERRAIN.rock, 0);
    setTileTerrain(state.grid, hx.indexOf(-1, 7), TERRAIN.rock, 0);
    const backoff = pickMinRangeBackoffNeighbor(state, artRow, bugRow, data);
    expect(backoff).not.toBeNull();
    expect(state.grid.layers.terrain[hx.indexOf(backoff![0], backoff![1])]).toBe(TERRAIN.slope);
    expect(rowOf(state.entities, artId)).toBe(artRow);
  });
});

describe('Hive placement boundary, hole center, occupancy, territory, and minimal fallback rules', () => {
  it('accepts TERRAIN.hole on center tile and rejects rim, water, buildings, wrecks, and owned territory in combat-test & normal sim', () => {
    const host = new SimHost(createRegistryPipeline({ flags: parseWaves('..07') }));
    const state = createState({ planetId: 'hive-bounds', planetType: 'desert', seed: 'hive-bounds', radius: 18 });
    const hx = hexIndex(state.grid.radius);
    state.grid.layers.terrain.fill(TERRAIN.slope);
    state.grid.layers.prep.fill(PREP.wild);
    state.grid.layers.height.fill(1.6);
    ensureColonyRecord(state, 0, 0).status = 'active';
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
    claimTerritoryRadius(state, { colonyId: 0, q: 0, r: 0, radius: 6, tick: 0 });
    host.load(state);

    let seq = 0;
    const submitHive = (args: Record<string, unknown>) => {
      host.submit({ commandId: `hv_${++seq}`, colonyIndex: 0, source: 'player', kind: 'dev.spawnhive', args });
      return host.step(1).outcomes[0]?.code;
    };

    // 1. Rim / out-of-bounds edges rejected so hexagons never truncate
    expect(submitHive({ species: 'blackAnt', q: 19, r: 0 })).toBe('invalid_args');
    expect(submitHive({ species: 'blackAnt', q: 18, r: 0 })).toBe('site_blocked');
    expect(submitHive({ species: 'blackAnt', q: 16, r: 0 })).toBe('site_blocked');

    // 2. Overlapping building footprint or wild owned colony territory rejected
    expect(submitHive({ species: 'blackAnt', q: 2, r: 0 })).toBe('site_blocked');
    expect(submitHive({ species: 'blackAnt', q: 5, r: 0 })).toBe('site_blocked');

    // 3. Dry center with water or mechanical wreck inside surrounding hex ring rejected
    setTileTerrain(state.grid, hx.indexOf(-10, 2), TERRAIN.shallow, host.tick);
    expect(submitHive({ species: 'blackAnt', q: -10, r: 0 })).toBe('site_blocked');

    const wreckIdx = hx.indexOf(-10, 8);
    recordMechanicalWreck(state, { id: 999, kind: ENTITY_KIND.demoTank, owner: 0, q: -10, r: 8, tiles: [wreckIdx] }, host.tick);
    expect(submitHive({ species: 'blackAnt', q: -10, r: 10 })).toBe('site_blocked');

    // 4. Center tile = TERRAIN.hole on valid wild patch succeeds and forms full 5x5 hexagons
    setTileTerrain(state.grid, hx.indexOf(0, -12), TERRAIN.hole, host.tick);
    expect(submitHive({ species: 'blueBeetle', q: 0, r: -12, initialResidents: 2 })).toBeUndefined();
    const layers = { terrain: state.grid.layers.terrain, prep: state.grid.layers.prep, height: state.grid.layers.height };
    for (const pt of getBuildingFootprintTiles(0, -12, 5)) {
      expect(isHexTile(state.grid.radius, hx.indexOf(pt.q, pt.r), layers), `5x5 hex (${pt.q},${pt.r})`).toBe(true);
    }

    // 5. Omitted coords relocate automatically when default offset is blocked by rim/water
    setTileTerrain(state.grid, hx.indexOf(15, 0), TERRAIN.deep, host.tick);
    expect(submitHive({ species: 'greenSpitter' })).toBeUndefined();
    const latestHive = getAllHives(state).find((h) => h.species === 'greenSpitter')!;
    expect(latestHive).toBeDefined();
    for (const pt of getBuildingFootprintTiles(latestHive.q, latestHive.r, 5)) {
      expect(isHexTile(state.grid.radius, hx.indexOf(pt.q, pt.r), layers)).toBe(true);
    }
  });
});

describe('Hive placement combat-test staging guard & worldgen minimal fallback', () => {
  it('rejects dev.spawnhive overlapping prepared staging territory in combat-test mode while accepting hole center outside staging', () => {
    const { host, meta } = createCombatTestHost({ planetType: 'desert', seed: 'ct-stage-guard', botCount: 1 });
    const hx = hexIndex(host.state.grid.radius);

    // Prepared staging tile (owner = 0) must be rejected in combat-test mode
    host.submit({
      commandId: 'ct_hive_staging',
      colonyIndex: 0,
      source: 'player',
      kind: 'dev.spawnhive',
      args: { species: 'blackAnt', q: meta.staging.q, r: meta.staging.r },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    // Center tile = TERRAIN.hole on unowned wild ground succeeds in combat-test mode
    const hq = 0;
    const hr = 22;
    for (let dr = -3; dr <= 3; dr++) {
      for (let dq = -3; dq <= 3; dq++) {
        const ti = hx.indexOf(hq + dq, hr + dr);
        if (ti >= 0 && host.state.grid.layers.owner[ti]! < 0) {
          setTileTerrain(host.state.grid, ti, dq === 0 && dr === 0 ? TERRAIN.hole : TERRAIN.slope, host.tick);
          setTilePrep(host.state.grid, ti, PREP.wild, host.tick);
        }
      }
    }
    host.submit({
      commandId: 'ct_hive_hole_center',
      colonyIndex: 0,
      source: 'player',
      kind: 'dev.spawnhive',
      args: { species: 'blackAnt', q: hq, r: hr },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(host.state.grid.layers.terrain[hx.indexOf(hq, hr)]).toBe(TERRAIN.flat);
  });

  it('ensures faunaHives minimal fallback pool keeps the entire 3x3 footprint dry and in-bounds on compact maps', () => {
    const state = createState({ planetId: 'compact-minimal', planetType: 'ocean', seed: 'compact-minimal', radius: 6 });
    const hx = hexIndex(state.grid.radius);
    state.grid.layers.terrain.fill(TERRAIN.deep);
    state.grid.layers.prep.fill(PREP.wild);

    // Dry 3x3 island at (-2, 1) surrounded by ocean so full & hexCore pools are empty, leaving only minimal pool
    for (const pt of getBuildingFootprintTiles(-2, 1, 3)) {
      setTileTerrain(state.grid, hx.indexOf(pt.q, pt.r), TERRAIN.slope, 0);
    }
    // Second patch around (2, -1) with dry center + neighbors EXCEPT footprint corner (3, 0) is deep water
    for (const pt of getBuildingFootprintTiles(2, -1, 3)) {
      setTileTerrain(state.grid, hx.indexOf(pt.q, pt.r), pt.q === 3 && pt.r === 0 ? TERRAIN.deep : TERRAIN.flat, 0);
    }

    const sites = planWorldgenHiveSites(state, { minExclusionRadius: 0, count: 3, allowCompactMap: true });
    expect(sites.length).toBeGreaterThanOrEqual(1);
    for (const s of sites) {
      expect([s.q, s.r]).not.toEqual([2, -1]);
      for (const pt of getBuildingFootprintTiles(s.q, s.r, 3)) {
        const ti = hx.indexOf(pt.q, pt.r);
        expect(ti).toBeGreaterThanOrEqual(0);
        expect(hexDistance(0, 0, pt.q, pt.r)).toBeLessThanOrEqual(state.grid.radius);
        expect(state.grid.layers.terrain[ti]).not.toBe(TERRAIN.deep);
        expect(state.grid.layers.terrain[ti]).not.toBe(TERRAIN.shallow);
      }
    }
  });
});

describe('Owned-seam hex-plane anchoring, dev.spawnraid validation, and Rival AI mountain avoidance', () => {
  it('anchors hive pad height to immutable owned core tiles when unowned hex tiles outnumber owned tiles, and rejects >0.05m owned spread', () => {
    const host = new SimHost(createRegistryPipeline({ flags: parseWaves('..07') }));
    const state = createState({ planetId: 'owned-seam', planetType: 'temperate', seed: 'owned-seam', radius: 22 });
    const hx = hexIndex(state.grid.radius);
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.flat);
    state.grid.layers.height.fill(0.08);
    ensureColonyRecord(state, 0, 0).status = 'active';

    // Owned prepared plateau on q <= 11 at height 0.80m; unowned open hex tiles on q >= 12 at 0.08m
    for (let i = 0; i < state.grid.count; i++) {
      if (hx.q[i]! <= 11 && hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 15) {
        setTileOwner(state.grid, i, 0, 0);
        setTilePrep(state.grid, i, PREP.prepared, 0);
        setTileHeight(state.grid, i, 0.8, 0);
      }
    }
    // Owned deposit at (7, 0) on a separate 0.45m plateau just outside the 7x7 core closure of hive (12, 0)
    for (const [dq, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const) {
      const di = hx.indexOf(7 + dq, dr);
      setTileOwner(state.grid, di, dq === 1 && dr === 0 ? -1 : 0, 0);
      setTilePrep(state.grid, di, PREP.prepared, 0);
      setTileHeight(state.grid, di, 0.45, 0);
    }
    setTileDeposit(state.grid, hx.indexOf(7, 0), DEPOSIT.metals, 10000, 0);
    host.load(state);

    host.submit({
      commandId: 'hv_seam_ok',
      colonyIndex: 0,
      source: 'player',
      kind: 'dev.spawnhive',
      args: { species: 'greenSpitter', q: 12, r: 0, mode: 'passive' },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    const layers = { terrain: state.grid.layers.terrain, prep: state.grid.layers.prep, height: state.grid.layers.height };
    for (const pt of getBuildingFootprintTiles(12, 0, 5)) {
      expect(isHexTile(state.grid.radius, hx.indexOf(pt.q, pt.r), layers), `seam 5x5 (${pt.q},${pt.r})`).toBe(true);
    }
    expect(isHexTile(state.grid.radius, hx.indexOf(7, 0), layers)).toBe(true);

    // Triangle-inequality spread check: owned tiles at 0.76m and 0.84m around 0.80m (0.08m > 0.05m) must be rejected
    setTileHeight(state.grid, hx.indexOf(8, -8), 0.8, host.tick);
    setTileHeight(state.grid, hx.indexOf(9, -8), 0.76, host.tick);
    setTileHeight(state.grid, hx.indexOf(10, -8), 0.84, host.tick);
    for (let fq = -3; fq <= 3; fq++) {
      for (let fr = -3; fr <= 3; fr++) {
        const ti = hx.indexOf(9 + fq, -8 + fr);
        if (ti >= 0) {
          setTileOwner(state.grid, ti, 0, host.tick);
          setTilePrep(state.grid, ti, PREP.prepared, host.tick);
          if (fq < -1 || fq > 1 || fr !== 0) setTileHeight(state.grid, ti, 0.8, host.tick);
        }
      }
    }
    host.submit({
      commandId: 'hv_spread_bad',
      colonyIndex: 0,
      source: 'player',
      kind: 'dev.spawnhive',
      args: { species: 'blackAnt', q: 9, r: -8 },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
  });
});

describe('dev.spawnraid fallback validation & Rival AI mountain avoidance', () => {
  it('validates fallback hive placement in dev.spawnraid and keeps Rival AI seeding & patrol off mountains', () => {
    const pipeline = createRegistryPipeline({ flags: parseWaves('..18') });
    const host = new SimHost(pipeline);
    const state = createPlanet({ id: 'raid-and-ai', seed: 'raid-and-ai', type: 'temperate', planetType: 'desert', radius: 22 });
    const hx = hexIndex(state.grid.radius);
    ensureColonyRecord(state, 0, 0).status = 'active';
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    setTileTerrain(state.grid, hx.indexOf(-10, 0), TERRAIN.deep, 0);
    host.load(state);

    host.submit({ commandId: 'sr_oob', colonyIndex: 0, source: 'player', kind: 'dev.spawnraid', args: { species: 'blackAnt', q: 99, r: 99 } });
    expect(host.step(1).outcomes[0]?.code).toBe('invalid_args');

    host.submit({ commandId: 'sr_water', colonyIndex: 0, source: 'player', kind: 'dev.spawnraid', args: { species: 'blackAnt', q: -10, r: 0 } });
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    // Rival AI seed & patrol on desert map ringed at dist 2..3 and first patrol offsets by mountains
    const aiState = createPlanet({ id: 'ai-mtn', seed: 'ai-mtn', type: 'temperate', planetType: 'desert', radius: 28 });
    const ahx = hexIndex(aiState.grid.radius);
    aiState.grid.layers.terrain.fill(TERRAIN.slope);
    aiState.grid.layers.prep.fill(PREP.wild);
    for (let i = 0; i < aiState.grid.count; i++) {
      const d = hexDistance(0, 0, ahx.q[i]!, ahx.r[i]!);
      if (d === 2 || d === 3 || d === 8) setTileTerrain(aiState.grid, i, TERRAIN.rock, 0);
    }
    const aiHost = new SimHost(pipeline);
    aiHost.load(aiState);
    seedRivalAiColonies(aiState, { count: 1, capacity: 2, tick: 0, data: pipeline.config.data });
    for (let r = 0; r < aiState.entities.count; r++) {
      const kind = aiState.entities.cols.kind[r]!;
      if (kind === ENTITY_KIND.worker || kind === ENTITY_KIND.recon) {
        const ti = ahx.indexOf(aiState.entities.cols.q[r]!, aiState.entities.cols.r[r]!);
        expect(aiState.grid.layers.terrain[ti]).not.toBe(TERRAIN.rock);
      }
    }
    // Block 4 of the 6 PATROL_OFFSETS around bot anchor with mountains, leaving dune patrol slots open
    const botColIdx = aiState.colonies.findIndex((c) => Boolean(c));
    let anchorQ = 0, anchorR = 0;
    for (let r = 0; r < aiState.entities.count; r++) {
      if (aiState.entities.cols.owner[r] === botColIdx && aiState.entities.cols.kind[r] === ENTITY_KIND.commandHub) {
        anchorQ = aiState.entities.cols.q[r]!;
        anchorR = aiState.entities.cols.r[r]!;
      }
    }
    for (const [dq, dr] of [[6, 0], [3, -6], [-3, -3], [-6, 0]] as const) {
      const pi = ahx.indexOf(anchorQ + dq, anchorR + dr);
      if (pi >= 0) setTileTerrain(aiState.grid, pi, TERRAIN.rock, 0);
    }
    const batch = planBackendBotActions(aiState, pipeline.config.data, parseWaves('..18'), 30, 0);
    const moveCmds = batch.commands.filter((c) => c.kind === 'moveUnit');
    expect(moveCmds.length).toBeGreaterThan(0);
    for (const cmd of moveCmds) {
      const args = cmd.args as { q: number; r: number };
      expect(aiState.grid.layers.terrain[ahx.indexOf(args.q, args.r)]).not.toBe(TERRAIN.rock);
      aiHost.submit(cmd);
      expect(aiHost.step(1).outcomes[0]?.code).toBeUndefined();
    }
  });
});
