import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow, rowOf } from '../../ecs/store';
import { PREP, TERRAIN } from '../../grid/layers';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import { applyDamage } from '../combat/damage';
import { evaluatePlacement } from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';
import { ensureColonyLedger } from '../economy/ledger';
import { queueColonyGoal } from '../goals';
import { getColonyGoals } from '../goals/store';
import { spawnHqUnit } from '../hq';
import { clearColonyCriticalOnHubRebuilt } from './critical';
import { colonyHasAliveHub, criticalTimerTicks, getColonyEliminationRecord } from './store';

const w18Data = compileData(parseWaves('..18'));

function setupColonyWithHubAndHq(radius = 16): {
  state: PlanetState;
  hubId: number;
  hqId: number;
  podId: number;
} {
  const state = createState({ planetId: 'pl-w18-08', planetType: 'temperate', seed: 'w18-08', radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col.status = 'active';
  col.stock['metals.t1'] = 500;
  col.stock['minerals.t1'] = 500;
  col.stock['bio.biomass'] = 300;
  col.stock['bio.water'] = 300;

  const podId = state.meta.nextEntityId++;
  const podRow = insertRow(state.entities, podId, 0);
  state.entities.cols.kind[podRow] = ENTITY_KIND.pod;
  state.entities.cols.owner[podRow] = 0;
  state.entities.cols.q[podRow] = 0;
  state.entities.cols.r[podRow] = 0;
  state.entities.cols.hp[podRow] = 500;
  state.entities.cols.hpMax[podRow] = 500;

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

  const hqId = spawnHqUnit(state, { owner: 0, q: 4, r: 0, tick: 0, data: w18Data });
  return { state, hubId, hqId, podId };
}

describe('W18-08 · Colony Critical unit tests', () => {
  it('enters Colony Critical with 10-min timer and inserts Re-establish goal at top when Hub is destroyed while HQ lives', () => {
    const { state, hubId } = setupColonyWithHubAndHq();
    queueColonyGoal(state, 0, { goal: 'secure_power' }, 5);
    queueColonyGoal(state, 0, { goal: 'grow_economy' }, 6);

    const dmg = applyDamage(state, hubId, 9999, { tick: 20, data: w18Data });
    expect(dmg.destroyed).toBe(true);
    expect(rowOf(state.entities, hubId)).toBe(-1);
    expect(colonyHasAliveHub(state, 0)).toBe(false);

    expect(state.colonies[0]?.status).toBe('critical');
    const rec = getColonyEliminationRecord(state, 0);
    expect(rec?.criticalDeadlineTick).toBe(20 + criticalTimerTicks(w18Data));
    expect(rec?.criticalDeadlineTick).toBe(3020);

    const goals = getColonyGoals(state, 0);
    expect(goals[0].goal).toBe('establish_colony');
    expect(goals[0].status).toBe('active');
    expect((goals[0].params as Record<string, unknown>).reestablish).toBe(true);
    expect(goals[0].detail).toContain('Re-establish');
    expect(goals[1].goal).toBe('secure_power');
    expect(goals[1].status).toBe('queued');
  });

  it('allows Hub placement on unclaimed tiles near the HQ even when far from original landing pod', () => {
    const { state, hubId, hqId } = setupColonyWithHubAndHq(18);
    applyDamage(state, hubId, 9999, { tick: 10, data: w18Data });

    // Move HQ far from original pod at (0, 0) onto unclaimed tiles at (12, 0)
    const hqRow = rowOf(state.entities, hqId);
    state.entities.cols.q[hqRow] = 12;
    state.entities.cols.r[hqRow] = 0;

    const world = placementWorldFromState(state);
    const evalRes = evaluatePlacement(world, {
      colonyId: 0,
      q: 11,
      r: 0,
      building: 'commandHub',
      data: w18Data,
    });
    expect(evalRes.ok).toBe(true);
  });

  it('clears Colony Critical timer and completes Re-establish goal when Hub is rebuilt', () => {
    const { state, hubId } = setupColonyWithHubAndHq();
    queueColonyGoal(state, 0, { goal: 'secure_power' }, 5);
    applyDamage(state, hubId, 9999, { tick: 10, data: w18Data });
    expect(state.colonies[0]?.status).toBe('critical');

    const cleared = clearColonyCriticalOnHubRebuilt(state, 0, 150);
    expect(cleared).toBe(true);
    expect(state.colonies[0]?.status).toBe('active');
    expect(getColonyEliminationRecord(state, 0)?.criticalDeadlineTick).toBeUndefined();

    const goals = getColonyGoals(state, 0);
    const reestablish = goals.find((g) => g.goal === 'establish_colony');
    expect(reestablish?.status).toBe('done');
    const powerGoal = goals.find((g) => g.goal === 'secure_power');
    expect(powerGoal?.status).toBe('active');
  });

  it('eliminates colony immediately when Hub is destroyed and HQ is already dead', () => {
    const { state, hubId, hqId } = setupColonyWithHubAndHq();
    // Remove HQ first without Hub reprint
    state.entities.cols.hp[rowOf(state.entities, hqId)] = 0;
    applyDamage(state, hubId, 9999, { tick: 30, data: w18Data, attackerOwner: 1 });

    expect(state.colonies[0]?.status).toBe('eliminated');
    expect(getColonyEliminationRecord(state, 0)?.eliminatedAtTick).toBe(30);
    expect(getColonyEliminationRecord(state, 0)?.criticalDeadlineTick).toBeUndefined();
  });
});
