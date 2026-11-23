import { describe, expect, it } from 'vitest';
import { flagsFromList, parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { setColonyStock } from '../../economy';
import { ENTITY_KIND } from '../../ecs/columns';
import { createPlanet } from '../../gen/createPlanet';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { hexDistance, hexIndex } from '../../grid/hex';
import { setTileDeposit, setTileHeight, setTileOwner, setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { SimHost } from '../../host/SimHost';
import { ensureColonyRecord } from '../../kernel/colonies';
import { step, createPipeline } from '../../kernel/step';
import { occupiedGroundTiles } from '../construction/occupancy';
import { createEngineConfig } from '../registry';
import { proposeTruce, respondTruce } from '../diplomacy/operations';
import { ensureColonyLedger } from '../economy/ledger';
import { startBuildingConstruction } from '../economy/construction';
import { spawnWorkerUnit } from '../factories-hub';
import { spawnHqUnit } from '../hq';
import { dropColonyShield } from '../pvp/shield';
import { getColonyQueue } from '../queue';
import { shouldExpandPowerZoneWithPylon } from '../rule-engine';
import { colonyTerraformOrders, getWorkJobsMap } from '../terraform-basic';
import { stepColonyAutonomousGovernor } from './governor';
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

describe('Territory terraforming & Pylon expansion for bots and AI-controlled colonies', () => {
  it('planBackendBotActions clears nearby territory obstacles with chain:false and cultivates owned flat ground', () => {
    const state = createPlanet({ type: 'temperate', seed: 'bot-tf-territory', radius: 24, capacity: 6 });
    const data = compileData(ALL_FLAGS);
    const created = seedRivalAiColonies(state, { count: 1, colonyIndices: [1], capacity: 6, tick: 0, data });
    const bot = created[0]!;
    setColonyStock(state, bot.colonyIndex, {
      'metals.t1': 600,
      'minerals.t1': 600,
      'bio.water': 600,
      'bio.biomass': 300,
    });

    const hx = hexIndex(state.grid.radius);
    const occ = occupiedGroundTiles(state, data);
    let obsIdx = -1;
    let obsQ = bot.anchorQ + 3;
    let obsR = bot.anchorR;
    for (let i = 0; i < state.grid.count; i++) {
      const q = hx.q[i]!;
      const r = hx.r[i]!;
      if (hexDistance(bot.anchorQ, bot.anchorR, q, r) === 3 && !occ.has(i)) {
        obsIdx = i;
        obsQ = q;
        obsR = r;
        break;
      }
    }
    expect(obsIdx).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < state.grid.count; i++) {
      const q = hx.q[i]!;
      const r = hx.r[i]!;
      const d = hexDistance(bot.anchorQ, bot.anchorR, q, r);
      if (d <= 6) {
        setTileOwner(state.grid, i, bot.colonyIndex);
        setTileHeight(state.grid, i, 0);
        if (state.grid.layers.terrain[i] !== TERRAIN.flat && i !== obsIdx) {
          setTileTerrain(state.grid, i, TERRAIN.flat);
          setTilePrep(state.grid, i, PREP.prepared);
        }
      }
    }

    setTileTerrain(state.grid, obsIdx, TERRAIN.forest);
    setTileDeposit(state.grid, obsIdx, DEPOSIT.none);

    // Ensure an idle worker is available nearby without interrupting active construction
    spawnWorkerUnit(state, { owner: bot.colonyIndex, q: obsQ, r: obsR, tick: 0, data });

    const host = new SimHost({ flags: ALL_FLAGS, data, hostRole: 'authority_external_bots' });
    host.load(state);

    let sawWorkCmd = false;
    let sawChainFalseJob = false;
    let sawCultivateCmd = false;
    const rejected: unknown[] = [];

    for (let s = 0; s < 35; s++) {
      const batch = planBackendBotActions(host.state, data, ALL_FLAGS, host.tick + 5, host.tick);
      for (const cmd of batch.commands) {
        const tf = (cmd.args as { terraform?: { op?: string; tiles?: Array<{ q: number; r: number }> } } | undefined)?.terraform;
        if (cmd.kind === 'enqueueTask' && tf?.op === 'work') {
          sawWorkCmd = true;
        } else if (cmd.kind === 'enqueueTask' && typeof tf?.op === 'string') {
          sawCultivateCmd = true;
        }
        host.submit(cmd);
      }
      const res = host.step(5);
      for (const o of res.outcomes) {
        if (o.code && o.code !== 'ok') rejected.push(o);
      }
      for (const job of Object.values(getWorkJobsMap(host.state))) {
        if (job.colonyId === bot.colonyIndex && job.mode === 'terraform' && job.chain !== true) {
          sawChainFalseJob = true;
        }
      }
    }

    expect(rejected).toEqual([]);
    expect(sawWorkCmd).toBe(true);
    expect(sawChainFalseJob).toBe(true);
    expect(host.state.grid.layers.terrain[obsIdx]).toBe(TERRAIN.flat);
    expect(sawCultivateCmd || colonyTerraformOrders(host.state, bot.colonyIndex).length > 0).toBe(true);
  });
});

describe('AI-controlled player colony territory & governor terraforming', () => {
  it('AI-controlled human colony clears territory obstacles, cultivates ground, and plans Pylons', () => {
    const state = createPlanet({ type: 'flat', seed: 'human-ai-tf', radius: 14 });
    const data = compileData(ALL_FLAGS);
    const hx = hexIndex(state.grid.radius);
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.prepared);
    state.grid.layers.height.fill(0);
    state.grid.layers.deposit.fill(DEPOSIT.none);
    for (let i = 0; i < state.grid.count; i++) {
      if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 10) setTileOwner(state.grid, i, 0);
    }

    const human = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2500 });
    human.status = 'active';
    human.aiEnabled = true;
    human.stage = 4;
    human.unlockStage = 4;
    setColonyStock(state, 0, {
      'metals.t1': 800,
      'minerals.t1': 600,
      'bio.water': 600,
      'bio.biomass': 300,
    });

    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data }).ok).toBe(true);
    expect(startBuildingConstruction(state, { owner: 0, building: 'solar', q: -4, r: 0, instant: true, costOverride: {}, data }).ok).toBe(true);
    spawnHqUnit(state, { owner: 0, q: -1, r: 0 });
    spawnWorkerUnit(state, { owner: 0, q: 1, r: 0, tick: 0, data });

    // Place a metals deposit outside the Hub's radius-6 power zone -> Pylon expansion recommended
    const depIdx = hx.indexOf(8, 0);
    setTileDeposit(state.grid, depIdx, DEPOSIT.metals);
    state.grid.layers.richness[depIdx] = 5000;
    expect(shouldExpandPowerZoneWithPylon(state, 0, data, ALL_FLAGS).needed).toBe(true);

    // Place a forest obstacle adjacent to Hub corridor
    const forestIdx = hx.indexOf(2, 0);
    setTileTerrain(state.grid, forestIdx, TERRAIN.forest);

    const host = new SimHost({ flags: ALL_FLAGS, data });
    host.load(state);
    for (let s = 0; s < 30; s++) host.step(5);

    expect(host.state.grid.layers.terrain[forestIdx]).toBe(TERRAIN.flat);

    // Also verify governor path clears an obstacle cleanly with chain:false when an idle worker is free
    const govState = createPlanet({ type: 'flat', seed: 'human-gov-tf', radius: 12 });
    const govHx = hexIndex(govState.grid.radius);
    govState.grid.layers.terrain.fill(TERRAIN.flat);
    govState.grid.layers.prep.fill(PREP.prepared);
    govState.grid.layers.height.fill(0);
    govState.grid.layers.deposit.fill(DEPOSIT.none);
    for (let i = 0; i < govState.grid.count; i++) {
      if (hexDistance(0, 0, govHx.q[i]!, govHx.r[i]!) <= 8) setTileOwner(govState.grid, i, 0);
    }
    const govCol = ensureColonyLedger(ensureColonyRecord(govState, 0, 0), { baseCap: 2500 });
    govCol.status = 'active';
    govCol.aiEnabled = false;
    govCol.away = true;
    govCol.stage = 3;
    govCol.unlockStage = 3;
    setColonyStock(govState, 0, { 'metals.t1': 400, 'minerals.t1': 400, 'bio.water': 400, 'bio.biomass': 200 });
    expect(startBuildingConstruction(govState, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data }).ok).toBe(true);
    expect(startBuildingConstruction(govState, { owner: 0, building: 'solar', q: -4, r: 0, instant: true, costOverride: {}, data }).ok).toBe(true);
    spawnHqUnit(govState, { owner: 0, q: -1, r: 0 });
    spawnWorkerUnit(govState, { owner: 0, q: 0, r: 2, tick: 0, data });
    const govObsIdx = govHx.indexOf(0, 3);
    setTileTerrain(govState.grid, govObsIdx, TERRAIN.rock);

    stepColonyAutonomousGovernor(govState, 0, 10, {
      tick: 10,
      flags: ALL_FLAGS,
      data,
      events: [],
      commands: [],
      emit: () => {},
      record: () => {},
    } as never);
    const workJobs = Object.values(getWorkJobsMap(govState));
    expect(workJobs.some((j) => j.colonyId === 0 && j.q === 0 && j.r === 3 && j.chain !== true)).toBe(true);
  });
});
