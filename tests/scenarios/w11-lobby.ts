import { CANONICAL_PLANETS } from '@terra/contracts';
import {
  buildAtlasManifest,
  claimTerritoryRadius,
  creditResource,
  DEPOSIT,
  DEV_PLANET_RADIUS,
  indexOf,
  PREP,
  revealVision,
  rowOf,
  setBlob,
  setTilePrep,
  spawnWorkerUnit,
  startBuildingConstruction,
  syncAtlasColonySectorState,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

function overrideSectorSlot0(
  sec: ReturnType<typeof buildAtlasManifest>['sectors'][number],
  sectorId: string,
  q: number,
  r: number,
) {
  const slot0 = {
    slotId: `slot_${sectorId}_0`,
    sectorId,
    slotIndex: 0,
    q,
    r,
  };
  const remaining = sec.safeLandingSlots
    .filter((sl) => sl.slotIndex !== 0)
    .map((sl) => ({ ...sl }));
  const slots = [slot0, ...remaining];
  return {
    ...sec,
    validatedSafeSites: slots.length,
    safeLandingSlots: slots,
  };
}

function seedW11AtlasBlob(state: PlanetState): void {
  const manifest = buildAtlasManifest(undefined, {
    planetId: CANONICAL_PLANETS.temperate.id,
    planetType: 'temperate',
    seed: 'w11-lobby-planets',
  });

  const sectors = manifest.sectors.map((sec) => {
    if (sec.sectorId === 'sec_0_0') return overrideSectorSlot0(sec, 'sec_0_0', 20, -10);
    if (sec.sectorId === 'sec_1_0') return overrideSectorSlot0(sec, 'sec_1_0', 29, -14);
    return {
      ...sec,
      safeLandingSlots: sec.safeLandingSlots.map((sl) => ({ ...sl })),
    };
  });

  const safeLandingSlots = sectors.flatMap((sec) => sec.safeLandingSlots);
  const atlasBlob = {
    atlasVersion: manifest.atlasVersion,
    topologyVersion: manifest.topologyVersion,
    genVersion: manifest.genVersion,
    configVersion: manifest.configVersion,
    configHash: manifest.configHash,
    atlasHash: manifest.atlasHash,
    resourceProfileId: manifest.resourceProfileId,
    resourceProfileHash: manifest.resourceProfileHash,
    sectorRadius: manifest.sectorRadius,
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
  };

  setBlob(state, 'atlas', atlasBlob, 0);
  setBlob(
    state,
    'spawnSlots',
    [
      {
        index: 0,
        q: 20,
        r: -10,
        takenBy: null,
        sectorId: 'sec_0_0',
        slotId: 'slot_sec_0_0_0',
        landingSlotId: 'slot_sec_0_0_0',
        sectorSlotIndex: 0,
      },
      {
        index: 1,
        q: 29,
        r: -14,
        takenBy: null,
        sectorId: 'sec_1_0',
        slotId: 'slot_sec_1_0_0',
        landingSlotId: 'slot_sec_1_0_0',
        sectorSlotIndex: 0,
      },
    ],
    0,
  );
}

function prepareCrossSectorBasin(state: PlanetState): void {
  const radius = state.grid.radius;
  for (let r = -18; r <= -6; r++) {
    for (let q = 16; q <= 32; q++) {
      const idx = indexOf(radius, q, r);
      if (idx < 0) continue;
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.height[idx] = 0.08;
      state.grid.layers.deposit[idx] = DEPOSIT.none;
      state.grid.layers.richness[idx] = 0;
      setTilePrep(state, idx, PREP.flat, 0);
    }
  }

  const depositTiles: ReadonlyArray<readonly [number, number, number]> = [
    [27, -13, DEPOSIT.metals],
    [28, -13, DEPOSIT.minerals],
    [21, -12, DEPOSIT.metals],
  ];
  for (const [q, r, dep] of depositTiles) {
    const idx = indexOf(radius, q, r);
    if (idx < 0) continue;
    state.grid.layers.deposit[idx] = dep;
    state.grid.layers.richness[idx] = 10_000;
  }
}

function seedCrossSectorColonyStructures(state: PlanetState, tick: number): void {
  claimTerritoryRadius(state, { colonyId: 0, q: 24, r: -12, radius: 7, tick });
  startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: 21,
    r: -11,
    instant: true,
    costOverride: {},
    tick,
  });
  startBuildingConstruction(state, {
    owner: 0,
    building: 'solar',
    q: 22,
    r: -11,
    instant: true,
    costOverride: {},
    tick,
  });
  startBuildingConstruction(state, {
    owner: 0,
    building: 'pylon',
    q: 24,
    r: -12,
    instant: true,
    costOverride: {},
    tick,
  });
  startBuildingConstruction(state, {
    owner: 0,
    building: 'pylon',
    q: 26,
    r: -13,
    instant: true,
    costOverride: {},
    tick,
  });

  const workerId = spawnWorkerUnit(state, { owner: 0, q: 24, r: -12, tier: 1 });
  const workerRow = rowOf(state.entities, workerId);
  state.entities.cols.hp[workerRow] = 400;
  state.entities.cols.hpMax[workerRow] = 400;
  state.entities.cols.cell[workerRow] = 200;
  state.entities.cols.cellMax[workerRow] = 200;
  state.entities.cols.workRate[workerRow] = 1.25;
}

/**
 * W11 Planet Foundations & Sector Admission seed scenario (`docs/plan/waves/W11-lobby-planets.md` & W11-32):
 * - Canonical temperate small-atlas topology (`7` land sectors + `12` ocean sectors = `19` total sectors, `R = 24`).
 * - Colony 0 (`col_0`, `Aegis Prime`) founded in `sec_0_0` (`slot_sec_0_0_0` at `(20, -10)`) with landed HQ.
 * - Cross-sector power chain (`sec_0_0` ↔ `sec_1_0`) and a boundary worker at `(24, -12)` ready to walk into `sec_1_0` (`(25, -12)`).
 */
export const w11LobbyScenario = defineScenario({
  id: 'w11',
  title: 'W11 Planet Foundations & Sector Admission',
  waves: '..11',
  seed: 'w11-lobby-planets',
  planet: { type: 'temperate', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(host, api) {
    const state = api.planet;
    prepareCrossSectorBasin(state);
    seedW11AtlasBlob(state);

    api.command('system.spawnColony', {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: 'Aegis Prime',
      slotIndex: 0,
      sectorId: 'sec_0_0',
      landingSlotId: 'slot_sec_0_0_0',
    });
    api.command('dev.land', {}, 0);

    seedCrossSectorColonyStructures(state, host.tick);
    revealVision(state, 0, 24, -12, 12, host.tick);

    const colony0 = state.colonies[0];
    if (colony0) {
      creditResource(colony0, 'metals.t1', 500, host.tick);
      creditResource(colony0, 'minerals.t1', 400, host.tick);
      creditResource(colony0, 'bio.biomass', 200, host.tick);
      creditResource(colony0, 'bio.water', 200, host.tick);
    }

    syncAtlasColonySectorState(state, host.tick);
    api.command('dev.skipnight', {});
  },
});

export default w11LobbyScenario;
