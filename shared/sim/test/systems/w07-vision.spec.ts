import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../src/data';
import { ENTITY_KIND, ENTITY_STATE } from '../../src/ecs/columns';
import { adminRelocateEntity, placeSpawnedEntity } from '../../src/ecs/placement';
import { isTileExplored } from '../../src/grid/tileModel';
import { hexIndex } from '../../src/grid/hex';
import { insertRow } from '../../src/ecs/store';
import { createState, type PlanetState } from '../../src/kernel/state';
import {
  BEACON_ENTITY_KIND,
  canAttackerSpotOrFireOnTarget,
  computeColonySpottedTileIndices,
  getEntitySpottingRadius,
  isTargetSpottedByColony,
  isTileSpottedByColony,
  updateColonyVisionCache,
} from '../../src/systems/combat/vision';

const data = compileData(parseWaves('..07'));

function spawnTestEntity(
  state: PlanetState,
  opts: {
    kind: number;
    owner: number;
    q: number;
    r: number;
    hp?: number;
    entityState?: number;
    tick?: number;
  },
): number {
  const tick = opts.tick ?? state.meta.tick;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 100;
  cols.hpMax[row] = opts.hp ?? 100;
  cols.state[row] = opts.entityState ?? ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  return row;
}

describe('W07-08: Entity spotting radii and 5-tick vision cache', () => {
  it('computes entity spotting radii from unit viewRadius and building footprint + 4 (Hub/Beacon + 6)', () => {
    expect(getEntitySpottingRadius(ENTITY_KIND.autocannon, data)).toBe(5);
    expect(getEntitySpottingRadius(ENTITY_KIND.laserTower, data)).toBe(5);
    expect(getEntitySpottingRadius(ENTITY_KIND.droneControlArray, data)).toBe(5);
    expect(getEntitySpottingRadius(ENTITY_KIND.pylon, data)).toBe(5);

    expect(getEntitySpottingRadius(ENTITY_KIND.metalsExtractor, data)).toBe(6);
    expect(getEntitySpottingRadius(ENTITY_KIND.solar, data)).toBe(6);
    expect(getEntitySpottingRadius(ENTITY_KIND.supplyDepot, data)).toBe(6);

    expect(getEntitySpottingRadius(ENTITY_KIND.roboticsFactory, data)).toBe(7);

    expect(getEntitySpottingRadius(ENTITY_KIND.hub, data)).toBe(9);
    expect(getEntitySpottingRadius(BEACON_ENTITY_KIND, data)).toBe(7);
    expect(getEntitySpottingRadius(ENTITY_KIND.pod, data)).toBe(7);

    expect(getEntitySpottingRadius(ENTITY_KIND.recon, data)).toBe(10);
    expect(getEntitySpottingRadius(ENTITY_KIND.hq, data)).toBe(9);
    expect(getEntitySpottingRadius(ENTITY_KIND.harvester, data)).toBe(7);
    expect(getEntitySpottingRadius(ENTITY_KIND.builder, data)).toBe(7);
    expect(getEntitySpottingRadius(ENTITY_KIND.blackAnt, data)).toBe(6);
  });

  it('updates the shared colony view set on a 5-tick cadence and ignores constructing/inert/descending entities', () => {
    const state = createState({
      planetId: 'p-vision-cadence',
      planetType: 'temperate',
      seed: 'vision-seed',
      radius: 16,
    });

    const siteRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 0,
      q: 0,
      r: 0,
      entityState: ENTITY_STATE.constructing,
    });
    expect(computeColonySpottedTileIndices(state, 0, data).size).toBe(0);

    state.entities.cols.state[siteRow] = ENTITY_STATE.active;
    updateColonyVisionCache(state, 0, data, true);
    expect(isTileSpottedByColony(state, 0, 5, 0, data)).toBe(true);
    expect(isTileSpottedByColony(state, 0, 7, 0, data)).toBe(false);

    spawnTestEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: 2,
      r: 0,
      entityState: ENTITY_STATE.idle,
      tick: 1,
    });

    state.meta.tick = 2;
    updateColonyVisionCache(state, 2, data);
    expect(isTileSpottedByColony(state, 0, 7, 0, data)).toBe(false);

    state.meta.tick = 4;
    updateColonyVisionCache(state, 4, data);
    expect(isTileSpottedByColony(state, 0, 7, 0, data)).toBe(false);

    state.meta.tick = 5;
    updateColonyVisionCache(state, 5, data);
    expect(isTileSpottedByColony(state, 0, 7, 0, data)).toBe(true);
  });
});

describe('W07-08: Long-range weapon spotting acceptance check', () => {
  it('unspotted target at range 7 of an Autocannon is not fired on until a Recon spots it', () => {
    const state = createState({
      planetId: 'p-vision-spotter',
      planetType: 'temperate',
      seed: 'spotter-seed',
      radius: 16,
    });

    const autocannonRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 0,
      q: 0,
      r: 0,
      hp: 450,
      entityState: ENTITY_STATE.active,
    });

    const antRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 7,
      r: 0,
      hp: 120,
      entityState: ENTITY_STATE.idle,
    });

    updateColonyVisionCache(state, 0, data, true);
    expect(isTargetSpottedByColony(state, 0, antRow, data)).toBe(false);
    expect(canAttackerSpotOrFireOnTarget(state, autocannonRow, antRow, 8, data)).toBe(false);

    const reconRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: -6,
      r: 0,
      hp: 240,
      entityState: ENTITY_STATE.moving,
    });
    updateColonyVisionCache(state, 0, data, true);
    expect(isTargetSpottedByColony(state, 0, antRow, data)).toBe(false);
    expect(canAttackerSpotOrFireOnTarget(state, autocannonRow, antRow, 8, data)).toBe(false);

    adminRelocateEntity(state.entities, reconRow, 2, 0, 5);
    state.meta.tick = 5;
    updateColonyVisionCache(state, 5, data);

    expect(isTargetSpottedByColony(state, 0, antRow, data)).toBe(true);
    expect(canAttackerSpotOrFireOnTarget(state, autocannonRow, antRow, 8, data)).toBe(true);
  });
});


describe('stationary units explore and departed units lose current sight', () => {
  it.each([ENTITY_KIND.recon, ENTITY_KIND.hq, ENTITY_KIND.builder, ENTITY_KIND.harvester, ENTITY_KIND.demoTank, ENTITY_KIND.demoArtillery])('uses unit kind %i as a real vision source', kind => {
    const state = createState({ planetId: 'fog', planetType: 'temperate', seed: 'fog', radius: 40 });
    const row = spawnTestEntity(state, { kind, owner: 0, q: 0, r: 0 });
    const radius = getEntitySpottingRadius(kind, data);
    expect(getEntitySpottingRadius(kind)).toBe(radius);
    const tile = hexIndex(40).indexOf(radius, 0);
    updateColonyVisionCache(state, 0, data, true);
    expect(isTileSpottedByColony(state, 0, radius, 0, data)).toBe(true);
    expect(isTileExplored(state.grid, tile, 0)).toBe(true);
    expect(isTileExplored(state.grid, tile, 1)).toBe(false);
    adminRelocateEntity(state.entities, row, -25, 0, 5);
    state.meta.tick = 5;
    updateColonyVisionCache(state, 5, data, true);
    expect(isTileSpottedByColony(state, 0, radius, 0, data)).toBe(false);
    expect(isTileExplored(state.grid, tile, 0)).toBe(true);
  });

  it('does not reveal from dead units or unbuilt sites', () => {
    const state = createState({ planetId: 'fog', planetType: 'temperate', seed: 'fog', radius: 20 });
    spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 0 });
    spawnTestEntity(state, { kind: ENTITY_KIND.hub, owner: 0, q: 0, r: 0, entityState: ENTITY_STATE.waiting });
    expect(computeColonySpottedTileIndices(state, 0, data).size).toBe(0);
  });
});
