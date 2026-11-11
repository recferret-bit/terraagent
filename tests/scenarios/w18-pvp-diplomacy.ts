import { CANONICAL_PLANETS, W11_DEFAULT_SECTOR_RADIUS } from '@terra/contracts';
import {
  buildAtlasManifest,
  claimTerritoryRadius,
  creditResource,
  DEPOSIT,
  dropColonyShield,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  indexOf,
  insertRow,
  markColonyContact,
  placeSpawnedEntity,
  PREP,
  revealVision,
  setBlob,
  setColonyShieldHours,
  setTilePrep,
  startBuildingConstruction,
  syncAtlasColonySectorState,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

export interface W18ColonySeed {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly color: number;
  readonly stage: number;
  readonly shieldHours: number;
  readonly origin: readonly [number, number];
  readonly stock: Readonly<Record<string, number>>;
  readonly reconTiles?: ReadonlyArray<readonly [number, number]>;
  readonly frontierDepotTile?: readonly [number, number];
  readonly frontierTurretTile?: readonly [number, number];
  readonly factoryTile?: readonly [number, number];
  readonly autopilotDirector?: boolean;
}

export const W18_COLONIES: readonly W18ColonySeed[] = [
  {
    index: 0,
    id: 'col_0',
    name: 'Colony A',
    color: 0xff6b00,
    stage: 4,
    shieldHours: 0,
    origin: [-12, 0],
    stock: { 'metals.t1': 400, 'minerals.t1': 300, 'bio.water': 250, 'bio.biomass': 250 },
    reconTiles: [
      [-5, 0],
      [-5, 1],
      [-4, 0],
      [-4, 1],
    ],
    factoryTile: [-9, 3],
  },
  {
    index: 1,
    id: 'col_1',
    name: 'Colony B',
    color: 0x2f8fff,
    stage: 4,
    shieldHours: 0,
    origin: [6, 0],
    stock: { 'metals.t1': 500, 'minerals.t1': 350, 'bio.water': 250, 'bio.biomass': 250 },
    frontierDepotTile: [-1, 0],
    frontierTurretTile: [3, 0],
  },
  {
    index: 2,
    id: 'col_2',
    name: 'Colony C',
    color: 0xf5a623,
    stage: 3,
    shieldHours: 5,
    origin: [-14, 16],
    stock: { 'metals.t1': 400, 'minerals.t1': 300, 'bio.water': 200, 'bio.biomass': 200 },
  },
  {
    index: 3,
    id: 'col_3',
    name: 'Colony D',
    color: 0x2fbf71,
    stage: 4,
    shieldHours: 0,
    origin: [0, -16],
    stock: { 'metals.t1': 500, 'minerals.t1': 350, 'bio.water': 250, 'bio.biomass': 250 },
    reconTiles: [
      [2, -15],
      [2, -16],
    ],
    autopilotDirector: true,
  },
  {
    index: 4,
    id: 'col_4',
    name: 'Colony E',
    color: 0x00d2ff,
    stage: 4,
    shieldHours: 0,
    origin: [16, -16],
    stock: { 'metals.t1': 500, 'minerals.t1': 350, 'bio.water': 250, 'bio.biomass': 250 },
    reconTiles: [
      [14, -15],
      [14, -16],
    ],
  },
];

function flattenBasin(state: PlanetState): void {
  const radius = state.grid.radius;
  for (let r = -24; r <= 24; r++) {
    for (let q = -24; q <= 24; q++) {
      const idx = indexOf(radius, q, r);
      if (idx < 0) continue;
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.height[idx] = 0.08;
      state.grid.layers.deposit[idx] = DEPOSIT.none;
      state.grid.layers.richness[idx] = 0;
      setTilePrep(state, idx, PREP.prepared, 0);
    }
  }
}

function seedW18Atlas(state: PlanetState): void {
  const manifest = buildAtlasManifest(undefined, {
    planetId: CANONICAL_PLANETS.temperate.id,
    planetType: 'temperate',
    seed: 'w18-pvp-diplomacy',
  });

  const slotDefs = W18_COLONIES.slice(0, manifest.foundingSeatsPerSector).map((col) => ({
    slotId: `slot_sec_0_0_${col.index}`,
    sectorId: 'sec_0_0' as const,
    slotIndex: col.index,
    q: col.origin[0],
    r: col.origin[1],
  }));

  const sectors = manifest.sectors.map((sec) => {
    if (sec.sectorId !== 'sec_0_0') {
      return { ...sec, safeLandingSlots: sec.safeLandingSlots.map((sl) => ({ ...sl })) };
    }
    const extra = sec.safeLandingSlots
      .filter((sl) => sl.slotIndex >= slotDefs.length)
      .map((sl) => ({ ...sl }));
    const slots = [...slotDefs, ...extra];
    return {
      ...sec,
      validatedSafeSites: slots.length,
      safeLandingSlots: slots,
    };
  });

  const safeLandingSlots = sectors.flatMap((sec) => sec.safeLandingSlots);
  setBlob(
    state,
    'atlas',
    {
      atlasVersion: manifest.atlasVersion,
      topologyVersion: manifest.topologyVersion,
      genVersion: manifest.genVersion,
      configVersion: manifest.configVersion,
      configHash: manifest.configHash,
      atlasHash: manifest.atlasHash,
      resourceProfileId: manifest.resourceProfileId,
      resourceProfileHash: manifest.resourceProfileHash,
      sectorRadius: manifest.sectorRadius,
      tilesPerSector: 7057,
      foundingSeatsPerSector: manifest.foundingSeatsPerSector,
      totalSectors: manifest.totalSectors,
      landSectors: manifest.landSectors,
      oceanSectors: manifest.oceanSectors,
      nominalCapacity: manifest.nominalCapacity,
      validatedCapacity: safeLandingSlots.length,
      sectors,
      safeLandingSlots,
      manifest: {
        ...manifest,
        validatedCapacity: safeLandingSlots.length,
        sectors,
      },
    },
    0,
  );

  setBlob(
    state,
    'spawnSlots',
    W18_COLONIES.map((col) => ({
      index: col.index,
      q: col.origin[0],
      r: col.origin[1],
      takenBy: col.index,
      sectorId: 'sec_0_0',
      slotId: `slot_sec_0_0_${col.index}`,
      landingSlotId: `slot_sec_0_0_${col.index}`,
      sectorSlotIndex: col.index,
    })),
    0,
  );
}

function buildInstant(state: PlanetState, owner: number, building: string, q: number, r: number): number {
  const out = startBuildingConstruction(state, {
    owner,
    building,
    q,
    r,
    instant: true,
    costOverride: {},
    tick: 0,
  });
  if (!out.ok) {
    throw new Error(`w18 scenario: ${building} at (${q}, ${r}) for colony ${owner}: ${out.code} ${out.detail ?? ''}`);
  }
  return out.entityId;
}

function spawnHq(state: PlanetState, owner: number, q: number, r: number): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const c = state.entities.cols;
  c.kind[row] = ENTITY_KIND.hq;
  c.owner[row] = owner;
  c.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  c.hp[row] = 800;
  c.hpMax[row] = 800;
  c.cell[row] = 800;
  c.cellMax[row] = 800;
  c.workRate[row] = 1.5;
  c.state[row] = ENTITY_STATE.idle;
  return id;
}

function spawnRecon(state: PlanetState, owner: number, q: number, r: number): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const c = state.entities.cols;
  c.kind[row] = ENTITY_KIND.recon;
  c.owner[row] = owner;
  c.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  c.hp[row] = 220;
  c.hpMax[row] = 220;
  c.state[row] = ENTITY_STATE.idle;
  return id;
}

function seedW18Colony(state: PlanetState, s: W18ColonySeed, w18Enabled: boolean): void {
  const [q, r] = s.origin;
  const colony = ensureColonyLedger(
    {
      index: s.index,
      id: s.id,
      name: s.name,
      color: s.color,
      status: 'active',
      stage: s.stage,
      unlockStage: s.stage,
      threatStage: s.stage,
      foundedAtTick: 0,
      foundingSectorId: 'sec_0_0',
      sectorId: 'sec_0_0',
      landingSlotId: `slot_sec_0_0_${s.index}`,
      discovered: true,
      neighborContact: true,
      q,
      r,
      changedAt: 0,
    },
    { depotCount: 1 },
  );
  state.colonies[s.index] = colony;

  const claimQ = s.index === 1 ? 4 : q;
  claimTerritoryRadius(state, { colonyId: s.index, q: claimQ, r, radius: 7, tick: 0 });

  const hubId = buildInstant(state, s.index, 'commandHub', q, r);
  colony.hubEntityId = hubId;
  buildInstant(state, s.index, 'solar', q - 3, r + 2);

  const [depotQ, depotR] = s.frontierDepotTile ?? [q - 3, r - 2];
  const depotId = buildInstant(state, s.index, 'supplyDepot', depotQ, depotR);
  if (s.frontierDepotTile) {
    for (let rIdx = 0; rIdx < state.entities.count; rIdx++) {
      if (state.entities.cols.id[rIdx] === depotId) {
        state.entities.cols.hp[rIdx] = 2400;
        state.entities.cols.hpMax[rIdx] = 2400;
        break;
      }
    }
  }

  const [facQ, facR] = s.factoryTile ?? [q + 3, r - 3];
  if (s.stage >= 3) {
    buildInstant(state, s.index, 'roboticsFactory', facQ, facR);
  }
  if (s.frontierTurretTile) {
    buildInstant(state, s.index, 'laserTower', s.frontierTurretTile[0], s.frontierTurretTile[1]);
  }

  spawnHq(state, s.index, q, r + 3);
  for (const [uq, ur] of s.reconTiles ?? []) {
    spawnRecon(state, s.index, uq, ur);
  }

  for (const [key, amount] of Object.entries(s.stock)) {
    creditResource(colony, key as never, amount, 0);
  }

  if (w18Enabled) {
    if (s.shieldHours > 0) {
      setColonyShieldHours(state, s.index, s.shieldHours, 0);
    } else {
      dropColonyShield(state, s.index, 0);
    }
  }
}

function revealAndContactAll(state: PlanetState, w18Enabled: boolean): void {
  for (const a of W18_COLONIES) {
    for (const b of W18_COLONIES) {
      revealVision(state, a.index, b.origin[0], b.origin[1], 14, 0);
      if (w18Enabled && a.index < b.index) {
        markColonyContact(state, a.index, b.index, 0);
      }
    }
  }
}

export const w18PvpDiplomacyScenario = defineScenario({
  id: 'w18',
  title: 'W18 PvP & Diplomacy',
  waves: '..18',
  seed: 'w18-pvp-diplomacy',
  planet: { type: 'temperate', planetType: 'temperate', radius: W11_DEFAULT_SECTOR_RADIUS },
  build(host, api) {
    const state = api.planet;
    const w18Enabled = [...host.pipeline.config.flags].includes('W18');
    flattenBasin(state);
    seedW18Atlas(state);
    for (const s of W18_COLONIES) {
      seedW18Colony(state, s, w18Enabled);
      if (s.autopilotDirector) {
        api.command('setAutopilot', { mode: 'director', awayRaids: false }, s.index);
      }
    }
    revealAndContactAll(state, w18Enabled);
    syncAtlasColonySectorState(state, host.tick);
    api.command('dev.skipnight', {});
  },
});

export default w18PvpDiplomacyScenario;
