import { describe, expect, it } from 'vitest';
import { flagsFromList, parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { createPlanet } from '../../gen/createPlanet';
import { SimHost } from '../../host/SimHost';
import { ensureColonyRecord } from '../../kernel/colonies';
import { step, createPipeline } from '../../kernel/step';
import { DEPOSIT } from '../../grid/layers';
import { createEngineConfig } from '../registry';
import { proposeTruce, respondTruce } from '../diplomacy/operations';
import { ensureColonyLedger } from '../economy/ledger';
import { spawnWorkerUnit } from '../factories-hub';
import { spawnHqUnit } from '../hq';
import { dropColonyShield } from '../pvp/shield';
import { getColonyQueue } from '../queue';
import { planBackendBotActions } from './planner';
import { crossedCadence, scanColonyState } from './plannerScan';
import { seedRivalAiColonies } from './seed';

const ALL_FLAGS = flagsFromList(parseWaves(null).list);

describe('planBackendBotActions & external bot hostRole', () => {
  it('marks seeded Rival AI colonies with isBot, botPersona, and foundingSectorId', () => {
    const state = createPlanet({ type: 'temperate', seed: 'bot-seed-meta', radius: 32, capacity: 8 });
    const created = seedRivalAiColonies(state, { count: 2, capacity: 8, tick: 0 });
    expect(created).toHaveLength(2);
    for (const meta of created) {
      const col = state.colonies[meta.colonyIndex]!;
      expect(col.isBot).toBe(true);
      expect(col.botPersona).toBe(meta.persona);
      expect(typeof col.foundingSectorId).toBe('string');
      expect(String(col.foundingSectorId).startsWith('sec_')).toBe(true);
    }
  });

  it('skips inline rivalAiSystem under authority_external_bots and plans explicit bot inputs', () => {
    const state = createPlanet({ type: 'temperate', seed: 'ext-bots-1', radius: 32, capacity: 8 });
    const data = compileData(ALL_FLAGS);
    const created = seedRivalAiColonies(state, { count: 2, capacity: 8, tick: 0, data });

    // Seat a human colony at index 0 with aiEnabled = true
    const human = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2500 });
    human.status = 'active';
    human.aiEnabled = true;
    human.stage = 2;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });

    const host = new SimHost({ flags: ALL_FLAGS, data, hostRole: 'authority_external_bots' });
    host.load(state);

    // Explicitly plan backend bot commands for step 0 -> 1
    const batch = planBackendBotActions(host.state, data, ALL_FLAGS, host.tick + 1, host.tick);
    expect(batch.commands.length).toBeGreaterThan(0);
    expect(batch.decisions.length).toBeGreaterThan(0);
    expect(batch.commands.every((c) => c.source === 'bot')).toBe(true);
    expect(batch.commands.every((c) => created.some((r) => r.colonyIndex === c.colonyIndex))).toBe(true);

    for (const cmd of batch.commands) host.submit(cmd);
    const res = host.step(1);
    expect(res.outcomes.length).toBe(batch.commands.length);
    const rejected = res.outcomes.filter((o) => o.code && o.code !== 'ok');
    expect(rejected).toEqual([]);
  });
});

describe('planBackendBotActions cadence, diplomacy & replica isolation', () => {
  it('plans reliably in coarse stepping (dt = 5) across arbitrary bot colony indices', () => {
    const state = createPlanet({ type: 'temperate', seed: 'coarse-bots', radius: 32, capacity: 10 });
    const data = compileData(ALL_FLAGS);
    // Use colony index 3 and 7 (neither matches tick % 10 === 0 or 5!)
    seedRivalAiColonies(state, { count: 2, capacity: 9, tick: 0, data }); // spawns 7 and 8
    const c7 = state.colonies[7]!;
    const c8 = state.colonies[8]!;
    expect(c7.isBot).toBe(true);
    expect(c8.isBot).toBe(true);
    spawnWorkerUnit(state, { owner: 7, q: Number(c7.spawnQ ?? 0) + 1, r: Number(c7.spawnR ?? 0) + 1, tick: 0, data });

    const pipeline = createPipeline(createEngineConfig({ flags: ALL_FLAGS, data, hostRole: 'authority_external_bots' }));
    const seenColonies = new Set<number>();

    // Step in dt = 5 increments from tick 0 to 30
    for (let t = 0; t < 30; t += 5) {
      const batch = planBackendBotActions(state, data, ALL_FLAGS, state.meta.tick + 5, state.meta.tick);
      for (const cmd of batch.commands) {
        if (typeof cmd.colonyIndex === 'number') seenColonies.add(cmd.colonyIndex);
      }
      step(state, batch.commands, 5, pipeline);
    }

    expect(seenColonies.has(7)).toBe(true);
    expect(seenColonies.has(8)).toBe(true);
  });

  it('responds to pending non-NEAR truce offers on diplomacy cadence', () => {
    const state = createPlanet({ type: 'temperate', seed: 'bot-truce', radius: 32, capacity: 8 });
    const data = compileData(ALL_FLAGS);
    const created = seedRivalAiColonies(state, { count: 2, capacity: 8, tick: 0, data });
    const trader = created.find((r) => r.persona === 'trader')!;
    const other = created.find((r) => r.colonyIndex !== trader.colonyIndex)!;
    const prop = proposeTruce(state, other.colonyIndex, trader.colonyIndex, 6, 1);
    expect(prop.ok).toBe(true);

    // Advance state tick close to trader's diplomacy cadence phase (trader.colonyIndex % 40)
    const targetPhase = trader.colonyIndex % 40;
    state.meta.tick = 40 + targetPhase - 2;
    const batch = planBackendBotActions(state, data, ALL_FLAGS, state.meta.tick + 5, state.meta.tick);
    const respond = batch.commands.find((c) => c.kind === 'diplomacy.respondTruce' && c.colonyIndex === trader.colonyIndex);
    expect(respond).toBeDefined();
    expect((respond?.args as { accept?: boolean })?.accept).toBe(true);
  });

  it('runs zero autonomous AI systems when hostRole is replica', () => {
    const state = createPlanet({ type: 'temperate', seed: 'replica-noop', radius: 32, capacity: 8 });
    const data = compileData(ALL_FLAGS);
    seedRivalAiColonies(state, { count: 1, capacity: 8, tick: 0, data });
    const human = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2500 });
    human.status = 'active';
    human.aiEnabled = true;
    human.stage = 3;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const entityCountBefore = state.entities.count;
    expect(entityCountBefore).toBeGreaterThan(0);

    const host = new SimHost({ flags: ALL_FLAGS, data, hostRole: 'replica' });
    host.load(state);
    host.step(1);
    expect(human.lastAutopilotEvalTick).toBeUndefined();
    expect(getColonyQueue(host.state, 7)).toHaveLength(0);
    expect(state.entities.cols.kind.slice(0, state.entities.count).filter((k) => k === ENTITY_KIND.worker).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Starter deposits, truce guards, and away governor parity', () => {
  it('gives seeded bots non-zero richness deposits, skips truced enemies, avoids dt=0 cadence spam, and still governs away humans under authority_external_bots', () => {
    expect(crossedCadence(1, 1, 10, 0)).toBe(false);
    expect(crossedCadence(0, 1, 10, 0)).toBe(true);

    const state = createPlanet({ type: 'temperate', seed: 'bot-rich-truce', radius: 32, capacity: 8 });
    const data = compileData(ALL_FLAGS);
    const created = seedRivalAiColonies(state, { count: 2, colonyIndices: [0, 1], capacity: 8, tick: 0, data });
    const bot0 = created[0]!;
    const bot1 = created[1]!;

    // Verify seeded starter deposits carry real > 0 richness so metalsExtractor / harvest work cleanly
    let nonZeroMetals = 0;
    for (let i = 0; i < state.grid.count; i++) {
      if (state.grid.layers.deposit[i] === DEPOSIT.metals && state.grid.layers.richness[i]! > 0) nonZeroMetals++;
    }
    expect(nonZeroMetals).toBeGreaterThanOrEqual(2);

    // Unshield bot1 -> scan sees bot1; establish truce -> scan clears nearestEnemy
    dropColonyShield(state, bot1.colonyIndex);
    const unshieldedScan = scanColonyState(state, bot0.colonyIndex, bot0.anchorQ, bot0.anchorR, data);
    expect(unshieldedScan.nearestEnemy?.colonyIndex).toBe(bot1.colonyIndex);

    const offer = proposeTruce(state, bot0.colonyIndex, bot1.colonyIndex, 6, 1);
    expect(offer.ok).toBe(true);
    if (!offer.ok) throw new Error('expected truce offer');
    const resp = respondTruce(state, bot1.colonyIndex, offer.offer.offerId, true, 1);
    expect(resp.ok).toBe(true);
    const scan = scanColonyState(state, bot0.colonyIndex, bot0.anchorQ, bot0.anchorR, data);
    expect(scan.nearestEnemy).toBeNull();

    // Seat an away human colony at index 2 and verify governor runs for away humans even under authority_external_bots
    const human = ensureColonyLedger(ensureColonyRecord(state, 2, 1), { baseCap: 2500 });
    human.status = 'active';
    human.away = true;
    human.aiEnabled = false;
    human.stage = 2;
    spawnHqUnit(state, { owner: 2, q: 0, r: 0 });
    const host = new SimHost({ flags: ALL_FLAGS, data, hostRole: 'authority_external_bots' });
    host.load(state);
    host.step(1);
    expect(getColonyQueue(host.state, 0)).toHaveLength(0);
    expect((host.state.blobs.rivalAi?.value as { lastGovernorTickByColony?: Record<number, number> } | undefined)?.lastGovernorTickByColony?.[2]).toBe(1);
  });
});
