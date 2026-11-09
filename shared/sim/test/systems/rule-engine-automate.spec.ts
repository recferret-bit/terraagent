import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow } from '../../src/ecs/store';
import { hexDistance, hexIndex } from '../../src/grid/hex';
import { PREP, TERRAIN } from '../../src/grid/layers';
import { view } from '../../src/host/view';
import { ensureColonyRecord } from '../../src/kernel/colonies';
import type { StepContext } from '../../src/kernel/context';
import { createState, setBlob, type PlanetState } from '../../src/kernel/state';
import { step } from '../../src/kernel/step';
import { ensureColonyLedger } from '../../src/systems/economy/ledger';
import { setColonyAiEnabled, setColonyPriorities } from '../../src/systems/goals';
import { getColonyQueue, saveQueueEntries } from '../../src/systems/queue';
import { createRegistryPipeline } from '../../src/systems/registry';
import {
  applyAutopilotStep,
  evaluateAutopilotDecision,
  getLastAutopilotDecision,
  getNeedAutomationSpec,
  isNeedAutomatedAtStage,
  NEED_AUTOMATION_TABLE,
  NEED_KEYS,
  resolveNeedMode,
  ruleEngineSystem,
  type NeedKey,
} from '../../src/systems/rule-engine';

function makeColonyPlanet(stage = 2): PlanetState {
  const state = createState({
    planetId: 'pl_autopilot_test',
    planetType: 'temperate',
    seed: 'w08-25-autopilot-seed',
    radius: 16,
  });
  const col = ensureColonyRecord(state, 0, 0);
  col.status = 'active';
  col.stage = stage;
  col.unlockStage = stage;
  setColonyAiEnabled(state, 0, true); // AI is off by default; the periodic system only runs while on
  const ledger = ensureColonyLedger(col, { baseCap: 500 });
  ledger.stock['metals.t1'] = 300;
  ledger.stock['minerals.t1'] = 250;

  const hx = hexIndex(state.grid.radius);
  const ownerLayer = state.grid.layers.owner as Int16Array;
  const terrainLayer = state.grid.layers.terrain as Uint8Array;
  const prepLayer = state.grid.layers.prep as Uint8Array;
  for (let i = 0; i < state.grid.count; i++) {
    if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 8) {
      ownerLayer[i] = 0;
      terrainLayer[i] = TERRAIN.flat;
      prepLayer[i] = PREP.prepared;
    }
  }

  const hubId = state.meta.nextEntityId++;
  const hubRow = insertRow(state.entities, hubId, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  placeSpawnedEntity(state.entities, hubRow, 0, 0, 0);
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  const extId = state.meta.nextEntityId++;
  const extRow = insertRow(state.entities, extId, 0);
  state.entities.cols.kind[extRow] = ENTITY_KIND.metalsExtractor;
  state.entities.cols.owner[extRow] = 0;
  placeSpawnedEntity(state.entities, extRow, 3, 0, 0);
  state.entities.cols.hp[extRow] = 500;
  state.entities.cols.hpMax[extRow] = 500;
  state.entities.cols.state[extRow] = ENTITY_STATE.active;

  const solarId = state.meta.nextEntityId++;
  const solarRow = insertRow(state.entities, solarId, 0);
  state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
  state.entities.cols.owner[solarRow] = 0;
  placeSpawnedEntity(state.entities, solarRow, 0, 3, 0);
  state.entities.cols.hp[solarRow] = 400;
  state.entities.cols.hpMax[solarRow] = 400;
  state.entities.cols.state[solarRow] = ENTITY_STATE.active;

  return state;
}

function configureHighPowerNeed(state: PlanetState): void {
  state.colonies[0]!.syntheticLoadPerS = 30;
  setBlob(
    state,
    'power',
    {
      byColony: {
        0: {
          colonyIndex: 0,
          hasHub: true,
          founderCorePerS: 8,
          solarGrossPerS: 21,
          solarInternalDrainPerS: 1,
          solarNetPerS: 20,
          supply: 28,
          demand: 17,
          rawDemand: 17,
          net: 11,
          brownout: false,
        },
      },
    },
    0,
  );
}

describe('W08-25 · "Learn by hand, then automate" stage gating table (UO-LC-05)', () => {
  it('maps each need to introducedStage and autoStage = introducedStage + 1', () => {
    const expected: Readonly<Record<NeedKey, { introducedStage: number; autoStage: number; target: string }>> = {
      extraction: { introducedStage: 1, autoStage: 2, target: 'metalsExtractor' },
      energy: { introducedStage: 2, autoStage: 3, target: 'wind' },
      storage: { introducedStage: 2, autoStage: 3, target: 'depot' },
      supply: { introducedStage: 2, autoStage: 3, target: 'depot' },
      defense: { introducedStage: 3, autoStage: 4, target: 'turret' },
      expand: { introducedStage: 4, autoStage: 5, target: 'outpostBeacon' },
      repair: { introducedStage: 1, autoStage: 2, target: 'repair' },
    };

    for (const key of NEED_KEYS) {
      const spec = getNeedAutomationSpec(key);
      expect(spec.introducedStage).toBe(expected[key].introducedStage);
      expect(spec.autoStage).toBe(expected[key].autoStage);
      expect(spec.autoStage).toBe(spec.introducedStage + 1);
      expect(spec.target).toBe(expected[key].target);
      expect(NEED_AUTOMATION_TABLE[key]).toEqual(spec);

      expect(isNeedAutomatedAtStage(key, spec.introducedStage)).toBe(false);
      expect(resolveNeedMode(key, spec.introducedStage, true)).toBe('suggestion');
      expect(isNeedAutomatedAtStage(key, spec.autoStage)).toBe(true);
      expect(resolveNeedMode(key, spec.autoStage, true)).toBe('auto');
      expect(resolveNeedMode(key, spec.autoStage, false)).toBe('idle');
    }
  });
});

describe('W08-25 · Acceptance: S2 power need emits suggestion only; S3 queues auto Wind order', () => {
  it('at S2 with high power need, emits suggestionOffered once and queues 0 orders', () => {
    const state = makeColonyPlanet(2);
    configureHighPowerNeed(state);

    const preview = evaluateAutopilotDecision(state, 0);
    expect(preview.need).toBe('energy');
    expect(preview.rawNeedBp).toBeGreaterThanOrEqual(6000);
    expect(preview.weightedBp).toBeGreaterThanOrEqual(6000);
    expect(preview.actionable).toBe(true);
    expect(preview.stage).toBe(2);
    expect(preview.introducedStage).toBe(2);
    expect(preview.autoStage).toBe(3);
    expect(preview.mode).toBe('suggestion');
    expect(preview.target).toBe('wind');

    const emitted: Array<Parameters<StepContext['emit']>[0]> = [];
    const decision1 = applyAutopilotStep(state, 0, { emit: (e) => emitted.push(e) });
    expect(decision1.mode).toBe('suggestion');
    expect(decision1.orderQueued).toBe(false);
    expect(decision1.suggestionEmitted).toBe(true);
    expect(getColonyQueue(state, 0)).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.kind).toBe('suggestionOffered');
    expect(eventDef('suggestionOffered').data.safeParse(emitted[0]!.data).success).toBe(true);
    expect(emitted[0]!.data).toMatchObject({
      colonyIndex: 0,
      stage: 2,
      kind: 'order',
      need: 'energy',
      lane: 'construction',
      target: 'wind',
    });

    // Second step at same (stage, need, target) does not emit duplicate suggestionOffered
    const decision2 = applyAutopilotStep(state, 0, { emit: (e) => emitted.push(e) });
    expect(decision2.suggestionEmitted).toBe(false);
    expect(emitted).toHaveLength(1);
    expect(getColonyQueue(state, 0)).toHaveLength(0);
  });

  it('at S3 with high power need, queues an auto (ai precedence) order for wind without duplicates', () => {
    const state = makeColonyPlanet(2);
    configureHighPowerNeed(state);
    const pipeline = createRegistryPipeline({ flags: parseWaves('..08') });

    // Step at S2 via ruleEngineSystem in pipeline: suggestion only, 0 orders
    const rS2 = step(state, [], 1, pipeline);
    expect(rS2.events.some((e) => e.kind === 'suggestionOffered')).toBe(true);
    expect(getColonyQueue(state, 0)).toHaveLength(0);

    // Advance colony to S3 -> ruleEngineSystem queues auto Wind order
    state.colonies[0]!.stage = 3;
    state.colonies[0]!.unlockStage = 3;
    const rS3 = step(state, [], 1, pipeline);
    expect(rS3.events.some((e) => e.kind === 'suggestionOffered')).toBe(false);

    const queue = getColonyQueue(state, 0);
    expect(queue).toHaveLength(1);
    const windOrder = queue[0]! as (typeof queue)[number] & { tag?: string; source?: string };
    expect(windOrder.lane).toBe('construction');
    expect(windOrder.precedence).toBe('ai');
    expect(windOrder.tag).toBe('auto');
    expect(windOrder.source).toBe('auto');
    expect(windOrder.task).toMatchObject({
      kind: 'build',
      building: 'wind',
    });

    // Running again while the auto Wind order is still open does not queue a second one
    const again = applyAutopilotStep(state, 0);
    expect(again.mode).toBe('auto');
    expect(again.orderQueued).toBe(false);
    expect(getColonyQueue(state, 0)).toHaveLength(1);
  });
});

describe('W08-25 · dev.autopilot command, priority slider weighting, and ViewColony projection', () => {
  it('populates colony.lastAutopilotDecision, state.blobs.autopilot, and ViewColony on dev.autopilot', () => {
    const state = makeColonyPlanet(2);
    configureHighPowerNeed(state);
    const pipeline = createRegistryPipeline({ flags: parseWaves('..08') });

    const r1 = step(
      state,
      [{ commandId: 'ap-1', colonyIndex: 0, source: 'dev', kind: 'dev.autopilot', args: { op: 'next' } }],
      1,
      pipeline,
    );
    expect(r1.outcomes[0]?.code).toBeUndefined();

    const last1 = getLastAutopilotDecision(state, 0);
    expect(last1).not.toBeNull();
    expect(last1).toMatchObject({
      colonyIndex: 0,
      stage: 2,
      need: 'energy',
      mode: 'suggestion',
      target: 'wind',
      orderQueued: false,
    });
    expect((state.blobs.autopilot as unknown as Record<string, unknown>)?.['0']).toMatchObject({
      need: 'energy',
      mode: 'suggestion',
      target: 'wind',
    });
    expect(view(state).colonies[0]?.lastAutopilotDecision).toMatchObject({
      need: 'energy',
      mode: 'suggestion',
      target: 'wind',
    });

    // A high expansion preference cannot invent demand when territory is ample.
    setColonyPriorities(state, 0, { expansion: 80 }, state.meta.tick);
    const r2 = step(
      state,
      [{ commandId: 'ap-2', colonyIndex: 0, source: 'dev', kind: 'dev.autopilot', args: { op: 'next' } }],
      1,
      pipeline,
    );
    expect(r2.outcomes[0]?.code).toBeUndefined();
    expect(view(state).colonies[0]?.lastAutopilotDecision).toMatchObject({
      need: 'energy',
      mode: 'suggestion',
      target: 'wind',
      priorityKey: 'power',
      priorityValue: 50,
    });
    expect(getColonyQueue(state, 0)).toHaveLength(0);

    // Reset expansion to 50, advance to S3, run dev.autopilot -> queues auto Wind order
    setColonyPriorities(state, 0, { expansion: 50 }, state.meta.tick);
    state.colonies[0]!.stage = 3;
    const r3 = step(
      state,
      [{ commandId: 'ap-3', colonyIndex: 0, source: 'dev', kind: 'dev.autopilot', args: { op: 'next' } }],
      1,
      pipeline,
    );
    expect(r3.outcomes[0]?.code).toBeUndefined();
    expect(view(state).colonies[0]?.lastAutopilotDecision).toMatchObject({
      stage: 3,
      need: 'energy',
      mode: 'auto',
      target: 'wind',
      orderQueued: true,
    });
    expect(getColonyQueue(state, 0)).toHaveLength(1);
    expect(getColonyQueue(state, 0)[0]?.task).toMatchObject({ kind: 'build', building: 'wind' });
  });

  it('rejects dev.autopilot with wave_disabled when W08 is off and runs ruleEngineSystem at slot 14', () => {
    expect(ruleEngineSystem.slot).toBe(14);
    expect(ruleEngineSystem.wave).toBe('W08');

    const state = makeColonyPlanet(3);
    configureHighPowerNeed(state);
    const w07Pipeline = createRegistryPipeline({ flags: parseWaves('..07') });
    const res = step(
      state,
      [{ commandId: 'ap-off', colonyIndex: 0, source: 'dev', kind: 'dev.autopilot', args: { op: 'next' } }],
      25,
      w07Pipeline,
    );
    expect(res.outcomes[0]?.code).toBe('wave_disabled');
    expect(getColonyQueue(state, 0)).toHaveLength(0);
  });
});


describe('Autopilot responds to demand instead of repeating a standing build job', () => {
  it('stops after generation meets demand, even with power at maximum, and resumes for new load', () => {
    const state = makeColonyPlanet(3);
    configureHighPowerNeed(state);
    const initial = applyAutopilotStep(state, 0);
    expect(initial).toMatchObject({ need: 'energy', orderQueued: true });

    // The queued generator has completed and its output now covers the colony.
    saveQueueEntries(state, [], 1);
    setBlob(state, 'power', { byColony: { 0: {
      founderCorePerS: 8, solarNetPerS: 0, windNetPerS: 45,
      generationPerS: 53, supply: 53, rawDemand: 17, net: 36, brownout: false,
    } } }, 1);
    for (let tick = 2; tick < 20; tick++) {
      const decision = applyAutopilotStep(state, 0, { tick, priorities: { power: 100 } });
      expect(decision.rawScores.energy).toBe(0);
      expect(decision.orderQueued).toBe(false);
    }
    expect(getColonyQueue(state, 0)).toHaveLength(0);

    configureHighPowerNeed(state);
    expect(applyAutopilotStep(state, 0)).toMatchObject({ need: 'energy', orderQueued: true });
  });

  it('counts a player generator already queued instead of adding its own duplicate', () => {
    const state = makeColonyPlanet(3);
    configureHighPowerNeed(state);
    applyAutopilotStep(state, 0);
    const queue = getColonyQueue(state, 0);
    queue[0]!.precedence = 'player';
    delete (queue[0] as unknown as Record<string, unknown>).tag;
    delete (queue[0] as unknown as Record<string, unknown>).source;
    saveQueueEntries(state, queue, 1);
    expect(applyAutopilotStep(state, 0).orderQueued).toBe(false);
    expect(getColonyQueue(state, 0)).toHaveLength(1);
    expect(getColonyQueue(state, 0)[0]!.precedence).toBe('player');
  });

  it('clears a stale power suggestion after the deficit is satisfied', () => {
    const state = makeColonyPlanet(2);
    configureHighPowerNeed(state);
    applyAutopilotStep(state, 0);
    expect(state.colonies[0]!.activeSuggestion).toBeDefined();
    setBlob(state, 'power', { byColony: { 0: {
      founderCorePerS: 8, windNetPerS: 45, supply: 53, rawDemand: 17, net: 36,
    } } }, 1);
    expect(applyAutopilotStep(state, 0).need).not.toBe('energy');
    expect(state.colonies[0]!.activeSuggestion).toBeUndefined();
  });
});
