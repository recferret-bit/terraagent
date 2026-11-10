import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow, rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import { applyDamage } from '../combat/damage';
import { ensureColonyLedger } from '../economy/ledger';
import { spawnHqUnit } from '../hq';
import { claimTerritoryRadius } from '../territory-claim';
import { eliminateColony, revertEliminatedColonyAnchors, stepRuinsDecay } from './ruins';
import {
  anchorRevertGraceTicks,
  getColonyEliminationRecord,
  getEliminationStore,
  isEntityRuin,
} from './store';

const w18Data = compileData(parseWaves('..18'));

function setupColonyWithBuildingsAndTerritory(): {
  state: PlanetState;
  hubId: number;
  hqId: number;
  solarId: number;
  workerId: number;
} {
  const state = createState({ planetId: 'pl-w18-09', planetType: 'temperate', seed: 'w18-09', radius: 14 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col.status = 'active';

  const hubId = state.meta.nextEntityId++;
  const hubRow = insertRow(state.entities, hubId, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  state.entities.cols.q[hubRow] = 0;
  state.entities.cols.r[hubRow] = 0;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  col.hubEntityId = hubId;

  const solarId = state.meta.nextEntityId++;
  const solarRow = insertRow(state.entities, solarId, 0);
  state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
  state.entities.cols.owner[solarRow] = 0;
  state.entities.cols.q[solarRow] = 4;
  state.entities.cols.r[solarRow] = 0;
  state.entities.cols.hp[solarRow] = 400;
  state.entities.cols.hpMax[solarRow] = 400;
  state.entities.cols.state[solarRow] = ENTITY_STATE.active;
  state.entities.cols.footprintW[solarRow] = 2;
  state.entities.cols.footprintD[solarRow] = 2;

  const workerId = state.meta.nextEntityId++;
  const workerRow = insertRow(state.entities, workerId, 0);
  state.entities.cols.kind[workerRow] = ENTITY_KIND.worker;
  state.entities.cols.owner[workerRow] = 0;
  state.entities.cols.q[workerRow] = 2;
  state.entities.cols.r[workerRow] = 0;
  state.entities.cols.hp[workerRow] = 120;
  state.entities.cols.hpMax[workerRow] = 120;
  state.entities.cols.state[workerRow] = ENTITY_STATE.idle;

  const hqId = spawnHqUnit(state, { owner: 0, q: 3, r: 0, tick: 0, data: w18Data });
  claimTerritoryRadius(state, { colonyId: 0, q: 0, r: 0, radius: 5, tick: 0, data: w18Data });

  return { state, hubId, hqId, solarId, workerId };
}

describe('W18-09 · Colony Eliminated & Ruins unit tests', () => {
  it('converts colony buildings to ruins (owner=-1, state=inert) and removes units on elimination', () => {
    const { state, hubId, hqId, solarId, workerId } = setupColonyWithBuildingsAndTerritory();

    // Destroy Hub first -> Colony Critical
    applyDamage(state, hubId, 9999, { tick: 10, data: w18Data });
    expect(state.colonies[0]?.status).toBe('critical');

    // Destroy HQ while Hub is down -> Colony Eliminated (both_lost)
    applyDamage(state, hqId, 9999, { tick: 20, data: w18Data, attackerOwner: 1 });
    expect(state.colonies[0]?.status).toBe('eliminated');

    const rec = getColonyEliminationRecord(state, 0);
    expect(rec?.eliminatedAtTick).toBe(20);
    expect(rec?.eliminatedByColonyId).toBe('col_1');
    expect(rec?.anchorRevertDeadlineTick).toBe(20 + anchorRevertGraceTicks(w18Data));
    expect(rec?.anchorRevertDeadlineTick).toBe(320);

    // Worker unit is removed; solar building becomes an inert unowned ruin
    expect(rowOf(state.entities, workerId)).toBe(-1);
    const solarRow = rowOf(state.entities, solarId);
    expect(solarRow).toBeGreaterThanOrEqual(0);
    expect(state.entities.cols.owner[solarRow]).toBe(-1);
    expect(state.entities.cols.state[solarRow]).toBe(ENTITY_STATE.inert);
    expect(isEntityRuin(state, solarId)).toBe(true);
  });

  it('decays ruins at 1% HP/s (0.002 * hpMax per tick) until cleared at 0 HP', () => {
    const { state, solarId } = setupColonyWithBuildingsAndTerritory();
    eliminateColony(state, 0, 'timer', 10, { data: w18Data });
    const store = getEliminationStore(state);

    // 50 seconds = 250 ticks -> 50% of 400 HP = 200 HP remaining
    stepRuinsDecay(state, store, 250, 260, w18Data);
    const solarRow = rowOf(state.entities, solarId);
    expect(state.entities.cols.hp[solarRow]).toBeCloseTo(200, 3);

    // Another 50 seconds = 250 ticks -> 0 HP, ruin removed and footprint prepared
    stepRuinsDecay(state, store, 250, 510, w18Data);
    expect(rowOf(state.entities, solarId)).toBe(-1);
    expect(store.ruins[solarId]).toBeUndefined();
  });

  it('reverts territory anchors to unclaimed (-1) when 60s grace expires and is idempotent on repeat calls', () => {
    const { state } = setupColonyWithBuildingsAndTerritory();
    const centerIdx = hexIndex(state.grid.radius).indexOf(0, 0);
    expect(state.grid.layers.owner[centerIdx]).toBe(0);

    eliminateColony(state, 0, 'timer', 10, { data: w18Data });
    // Calling eliminateColony a second time is a no-op
    eliminateColony(state, 0, 'both_lost', 50, { data: w18Data });
    expect(getColonyEliminationRecord(state, 0)?.eliminatedAtTick).toBe(10);

    // Before revert, tiles are still owned by 0 with graceUntil = 310
    expect(state.grid.layers.owner[centerIdx]).toBe(0);
    expect(state.grid.layers.graceUntil[centerIdx]).toBe(310);

    const revertedCount = revertEliminatedColonyAnchors(state, 0, 310);
    expect(revertedCount).toBeGreaterThan(0);
    expect(state.grid.layers.owner[centerIdx]).toBe(-1);
    expect(state.grid.layers.anchors[centerIdx]).toBe(0);
  });
});
