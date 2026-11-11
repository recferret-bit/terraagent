import { describe, expect, it } from 'vitest';
import {
  createState,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  markTileExplored,
  placeSpawnedEntity,
  PREP,
  TERRAIN,
  updateColonyVisionCache,
  type PlanetState,
} from '../../index';
import {
  raidTargetPriorityForKind,
  resolveDormantGateBypassTile,
  resolvePassableRaidApproachTile,
  selectSpottedRaidTarget,
} from './raidPathing';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp ?? 200;
  state.entities.cols.hpMax[row] = spec.hp ?? 200;
  state.entities.cols.state[row] = spec.state ?? ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, 0);
  return id;
}

describe('W18-04 · raid pathing & spotted target priority unit tests (UO-W-08)', () => {
  it('prioritizes spotted frontier defenses over depots/hubs, and ignores unspotted interior defenses until spotted', () => {
    const state = createState({ planetId: 'pl-w18-04-u1', planetType: 'temperate', seed: 'w18-04-u1', radius: 28 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);

    ensureColonyRecord(state, 0, 0).stage = 4;
    ensureColonyRecord(state, 1, 0).stage = 4;

    expect(raidTargetPriorityForKind(ENTITY_KIND.autocannon)).toBe(0);
    expect(raidTargetPriorityForKind(ENTITY_KIND.laserTower)).toBe(0);
    expect(raidTargetPriorityForKind(ENTITY_KIND.supplyDepot)).toBe(1);
    expect(raidTargetPriorityForKind(ENTITY_KIND.commandHub)).toBe(1);
    expect(raidTargetPriorityForKind(ENTITY_KIND.solar)).toBe(2);
    expect(raidTargetPriorityForKind(ENTITY_KIND.recon)).toBe(3);

    // Attacker Recon at (0, 0) has viewRadius = 10
    addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    // Spotted depot at (6, 0) and spotted frontier turret at (8, 0)
    const depotId = addEntity(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 6, r: 0 });
    const frontierTurretId = addEntity(state, { kind: ENTITY_KIND.laserTower, owner: 1, q: 8, r: 0 });
    // Unspotted closer-priority turret way out at (18, 0)
    addEntity(state, { kind: ENTITY_KIND.autocannon, owner: 1, q: 18, r: 0 });

    updateColonyVisionCache(state, 0, undefined, true);

    const sel = selectSpottedRaidTarget(state, 0, 1, 0, 0);
    expect(sel.targetEntityId).toBe(frontierTurretId);
    expect(sel.q).toBe(8);
    expect(sel.r).toBe(0);
    expect(sel.spotted).toBe(true);
    expect(sel.targetEntityId).not.toBe(depotId);
  });

  it('targets the nearest passable frontier tile when no enemy structure is spotted yet, and falls back to passable approach around water', () => {
    const state = createState({ planetId: 'pl-w18-04-u2', planetType: 'temperate', seed: 'w18-04-u2', radius: 28 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);

    ensureColonyRecord(state, 0, 0).stage = 4;
    ensureColonyRecord(state, 1, 0).stage = 4;

    const idx = hexIndex(state.grid.radius);
    state.grid.layers.owner[idx.indexOf(14, 0)] = 1;
    state.grid.layers.owner[idx.indexOf(16, 0)] = 1;

    // Enemy hub at (18, 0) outside attacker Recon's vision at (0, 0)
    const hubId = addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 1, q: 18, r: 0 });
    addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    updateColonyVisionCache(state, 0, undefined, true);

    const unspottedSel = selectSpottedRaidTarget(state, 0, 1, 0, 0);
    expect(unspottedSel.targetEntityId).toBeNull();
    expect(unspottedSel.q).toBe(14);
    expect(unspottedSel.r).toBe(0);
    expect(unspottedSel.spotted).toBe(false);

    // Once tile (18, 0) is explored, the hub is selected
    markTileExplored(state.grid, idx.indexOf(18, 0), 0, 1);
    const exploredSel = selectSpottedRaidTarget(state, 0, 1, 0, 0);
    expect(exploredSel.targetEntityId).toBe(hubId);
    expect(exploredSel.spotted).toBe(true);

    // Passable approach fallback when center tile is deep water
    state.grid.layers.terrain[idx.indexOf(18, 0)] = TERRAIN.deep;
    const approach = resolvePassableRaidApproachTile(state, 0, 0, 18, 0);
    expect(idx.indexOf(approach.q, approach.r)).toBeGreaterThanOrEqual(0);
    expect(approach.q !== 18 || approach.r !== 0).toBe(true);
    expect(resolveDormantGateBypassTile(state, 18, 0)).toEqual({ q: 18, r: 0 });
  });
});
