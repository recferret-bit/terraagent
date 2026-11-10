import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow, rowOf } from '../../ecs/store';
import { PREP, TERRAIN } from '../../grid/layers';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import { applyDamage } from '../combat/damage';
import { ensureColonyLedger } from '../economy/ledger';
import { queueColonyGoal } from '../goals';
import { getColonyGoals } from '../goals/store';
import { spawnHqUnit } from '../hq';
import { enqueueQueueTask, getColonyQueue } from '../queue';
import { enqueueHqReprintAtFront, onHqDestroyed } from './operations';
import {
  colonyHasAliveHq,
  colonyHasAliveHub,
  getColonyEliminationRecord,
  hqReprintCost,
  hqReprintRepeatWindowTicks,
  hqReprintTicks,
} from './store';

const w18Data = compileData(parseWaves('..18'));
const w07Data = compileData(parseWaves('..07'));

function setupColonyWithHubAndHq(radius = 12): {
  state: PlanetState;
  hubId: number;
  hqId: number;
} {
  const state = createState({ planetId: 'pl-w18-07', planetType: 'temperate', seed: 'w18-07', radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col.status = 'active';
  col.stock['metals.t1'] = 500;
  col.stock['minerals.t1'] = 500;
  col.stock['bio.biomass'] = 300;
  col.stock['bio.water'] = 300;

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

  const hqId = spawnHqUnit(state, { owner: 0, q: 3, r: 0, tick: 0, data: w18Data });
  return { state, hubId, hqId };
}

describe('W18-07 · HQ destruction & reprint unit tests', () => {
  it('destroys HQ at 0 HP under W18 and queues 60s reprint at the front of the Units lane', () => {
    const { state, hqId } = setupColonyWithHubAndHq();
    expect(colonyHasAliveHub(state, 0)).toBe(true);
    expect(colonyHasAliveHq(state, 0)).toBe(true);

    // Queue a worker first so the units lane is non-empty
    const workerRes = enqueueQueueTask(state, {
      colonyIndex: 0,
      task: { kind: 'buildUnit', unit: 'worker', tier: 1, count: 1 },
      precedence: 'player',
      tick: 5,
      data: w18Data,
    });
    expect(workerRes.ok).toBe(true);

    // Queue an active HQ goal to verify it pauses
    const goalRes = queueColonyGoal(state, 0, { goal: 'secure_power' }, 5);
    expect(goalRes.ok).toBe(true);

    const dmg = applyDamage(state, hqId, 9999, { tick: 10, data: w18Data });
    expect(dmg.destroyed).toBe(true);
    expect(dmg.clampedHq).toBe(false);
    expect(rowOf(state.entities, hqId)).toBe(-1);
    expect(colonyHasAliveHq(state, 0)).toBe(false);

    const unitsQueue = getColonyQueue(state, 0, 'units');
    expect(unitsQueue.length).toBe(2);
    expect(unitsQueue[0].task).toEqual({ kind: 'buildUnit', unit: 'hq', tier: 1, count: 1 });
    expect(unitsQueue[0].precedence).toBe('system');
    expect(unitsQueue[0].buildTicks).toBe(hqReprintTicks(w18Data, false));
    expect(unitsQueue[0].buildTicks).toBe(300);
    expect(unitsQueue[0].cost).toEqual(hqReprintCost(w18Data));
    expect(unitsQueue[0].state).toBe('in_progress');
    expect(unitsQueue[1].task).toMatchObject({ kind: 'buildUnit', unit: 'worker' });

    const goals = getColonyGoals(state, 0);
    expect((goals[0] as unknown as { paused?: boolean }).paused).toBe(true);
    expect(getColonyEliminationRecord(state, 0)?.hqDown).toBe(true);
  });

  it('uses 90s (450 ticks) reprint time when HQ is destroyed again within 10 min, and 60s after 10 min', () => {
    const { state } = setupColonyWithHubAndHq();
    const first = enqueueHqReprintAtFront(state, 0, 100, w18Data);
    expect(first.buildTicks).toBe(300);

    // Clear the first reprint entry so a second loss can queue a new reprint
    state.blobs.queue = { value: { entries: [] }, changedAt: 200 };
    const windowTicks = hqReprintRepeatWindowTicks(w18Data);
    expect(windowTicks).toBe(3000);

    // Destroyed again within 10 min (at tick 100 + 2500) -> 90s (450 ticks)
    const repeated = enqueueHqReprintAtFront(state, 0, 100 + 2500, w18Data);
    expect(repeated.buildTicks).toBe(450);

    // Destroyed again after > 10 min (at tick 2600 + 3001) -> 60s (300 ticks)
    state.blobs.queue = { value: { entries: [] }, changedAt: 5601 };
    const afterWindow = enqueueHqReprintAtFront(state, 0, 2600 + 3001, w18Data);
    expect(afterWindow.buildTicks).toBe(300);
  });

  it('preserves W07 clamp-at-1-HP when W18 is disabled and rejects manual player HQ buildUnit', () => {
    const { state, hqId } = setupColonyWithHubAndHq();
    const clamp = applyDamage(state, hqId, 9999, { tick: 10, data: w07Data });
    expect(clamp.clampedHq).toBe(true);
    expect(clamp.destroyed).toBe(false);
    expect(rowOf(state.entities, hqId)).toBeGreaterThanOrEqual(0);

    const manualHq = enqueueQueueTask(state, {
      colonyIndex: 0,
      task: { kind: 'buildUnit', unit: 'hq', tier: 1, count: 1 },
      precedence: 'player',
      tick: 12,
      data: w18Data,
    });
    expect(manualHq.ok).toBe(false);
    if (!manualHq.ok) {
      expect(manualHq.code).toBe('invalid_args');
    }
  });

  it('eliminates the colony immediately when HQ is destroyed while no Hub is alive', () => {
    const { state, hubId, hqId } = setupColonyWithHubAndHq();
    // Destroy Hub first
    applyDamage(state, hubId, 9999, { tick: 5, data: w18Data });
    expect(colonyHasAliveHub(state, 0)).toBe(false);

    onHqDestroyed(state, 0, 10, { data: w18Data, attackerOwner: 1 });
    expect(state.colonies[0]?.status).toBe('eliminated');
    expect(getColonyEliminationRecord(state, 0)?.eliminatedAtTick).toBe(10);
    expect(rowOf(state.entities, hqId)).toBeGreaterThanOrEqual(0);
  });
});
