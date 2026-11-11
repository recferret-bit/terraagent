import { describe, expect, it } from 'vitest';
import {
  createState,
  ensureColonyAt,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  PREP,
  TERRAIN,
  type PlanetState,
} from '../../index';
import { setColonyShieldHours } from './shield';
import {
  findForeignSiphonBuildingInRange,
  getUnitSiphonedAmount,
  isSiphonTargetBuildingKind,
  resetUnitSiphonCarry,
} from './siphon';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number; fw?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp ?? 500;
  state.entities.cols.hpMax[row] = spec.hp ?? 500;
  state.entities.cols.state[row] = spec.state ?? ENTITY_STATE.active;
  if (spec.fw) {
    state.entities.cols.footprintW[row] = spec.fw;
    state.entities.cols.footprintD[row] = spec.fw;
  }
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, 0);
  return { id, row };
}

describe('W18-05 · PvP depot/hub siphon unit tests (UO-W-08, DI-16)', () => {
  it('detects foreign Supply Depot and Command Hub within siphonRangeTiles (1 tile from footprint edge)', () => {
    const state = createState({ planetId: 'pl-w18-05-u1', planetType: 'temperate', seed: 'w18-05-u1', radius: 20 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);

    const col0 = ensureColonyAt(state, 0, 0);
    col0.stage = 4;
    const col1 = ensureColonyAt(state, 1, 0);
    col1.stage = 4;

    expect(isSiphonTargetBuildingKind(ENTITY_KIND.supplyDepot)).toBe(true);
    expect(isSiphonTargetBuildingKind(ENTITY_KIND.commandHub)).toBe(true);
    expect(isSiphonTargetBuildingKind(ENTITY_KIND.solar)).toBe(false);

    // 2x2 Supply Depot at (5, 0) has footprintAttackRange(1, 2) = 2
    const depot = addEntity(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 5, r: 0, fw: 2 });
    const nearRecon = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 3, r: 0 });
    const farRecon = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0 });
    const worker = addEntity(state, { kind: ENTITY_KIND.worker, owner: 0, q: 4, r: 0 });

    expect(findForeignSiphonBuildingInRange(state, nearRecon.row, 0)).toBe(depot.row);
    expect(findForeignSiphonBuildingInRange(state, farRecon.row, 0)).toBe(-1);
    expect(findForeignSiphonBuildingInRange(state, worker.row, 0)).toBe(-1);

    // Shielded target colony cannot be siphoned
    setColonyShieldHours(state, 1, 4, 0);
    expect(findForeignSiphonBuildingInRange(state, nearRecon.row, 0)).toBe(-1);
  });

  it('tracks and resets per-unit siphon carry state cleanly', () => {
    const state = createState({ planetId: 'pl-w18-05-u2', planetType: 'temperate', seed: 'w18-05-u2', radius: 16 });
    ensureColonyAt(state, 0, 0);
    expect(getUnitSiphonedAmount(state, 0, 10)).toBe(0);
    resetUnitSiphonCarry(state, 0, 10, 0);
    expect(getUnitSiphonedAmount(state, 0, 10, 'metals.t1')).toBe(0);
  });
});
