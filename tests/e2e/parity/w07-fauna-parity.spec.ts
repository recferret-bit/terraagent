import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { commandGate, parseWaves, precheckClientCommand } from '@terra/contracts';
import { compareSnapshots } from '@terra/scenarios/parity/compare';
import {
  createPlanet,
  createRegistryPipeline,
  createState,
  decodeSnapshot,
  drainFaunaDirectivesOutbox,
  emitFaunaDirective,
  encodeSnapshot,
  ensureColonyRecord,
  ENTITY_KIND,
  fireProjectile,
  getActiveCohorts,
  getAllHives,
  getAllResidentBugs,
  getFaunaDirectivesSince,
  getFaunaDirectivesState,
  getHiveRecord,
  getMotion,
  getPendingProjectileImpacts,
  getResidentBugRecord,
  hexDistance,
  hexIndex,
  nextFaunaGameplayRng,
  PREP,
  provokeHiveAgainstColony,
  rowOf,
  setTilePrep,
  SimHost,
  spawnHiveEntity,
  spawnHqUnit,
  TERRAIN,
  TICK_MS,
  buildFaunaSparseCorrection,
} from '@terra/sim';
import { CombatSyncController } from '../../../frontend/game/app/online/combatSync';
import { Predictor } from '../../../frontend/game/store/prediction/Predictor';
import { ReplicaCore } from '../../../frontend/game/store/replica/ReplicaCore';
import { packView, unpackView } from '../../../frontend/game/store/replica/viewCodec';
import {
  attachEventCollector,
  buildW07ParitySeedState,
  collectEntitySummary,
  createDualHostsFromSnapshot,
  makeWelcome,
  spawnColonyUnit,
  stepServerLocalAndReplicas,
} from './w07-fauna-parity-helpers';

describe('W07-35 · 1. Server host + LocalHost + two browser client replicas parity', () => {
  it('converges on identical tick, hive states, bug positions/modes/targets, entity HP, and confirmed deaths', () => {
    const { initialBytes, flags, data, reconId, baitUnitId, spitterHiveId } = buildW07ParitySeedState('w07-four-way-parity');
    const { serverHost, localHost } = createDualHostsFromSnapshot('w07-local-parity', flags.list, initialBytes);

    const replicaA = new ReplicaCore();
    const replicaB = new ReplicaCore();
    const syncA = new CombatSyncController(new THREE.Scene());
    const syncB = new CombatSyncController(new THREE.Scene());

    expect(replicaA.welcome(makeWelcome(serverHost, flags.list))).toEqual({ ok: true });
    expect(replicaB.welcome(makeWelcome(serverHost, flags.list))).toEqual({ ok: true });
    syncA.syncPlanetState(replicaA.state);
    syncB.syncPlanetState(replicaB.state);

    const serverEvents = attachEventCollector(serverHost);
    const commandSchedule: Array<{ atTick: number; id: string; kind: string; args: Record<string, unknown> }> = [
      { atTick: 0, id: 'cmd-stance', kind: 'setStance', args: { entityId: reconId, stance: 'hold' } },
      { atTick: 1, id: 'cmd-attack', kind: 'attackTarget', args: { entityId: reconId, targetId: spitterHiveId } },
      { atTick: 20, id: 'cmd-amove', kind: 'attackMove', args: { entityId: reconId, q: 2, r: 0 } },
    ];

    for (let step = 0; step < 30; step++) {
      for (const c of commandSchedule) {
        if (c.atTick === step) {
          serverHost.submit({ colonyIndex: 0, source: 'player', commandId: c.id, kind: c.kind, args: c.args });
          localHost.send({ t: 'cmd', id: c.id, d: { kind: c.kind, args: c.args } });
        }
      }
      stepServerLocalAndReplicas({
        serverHost,
        localHost,
        serverEvents,
        replicas: [
          { replica: replicaA, sync: syncA },
          { replica: replicaB, sync: syncB },
        ],
        data,
      });
    }

    expect(serverHost.tick).toBe(30);
    expect(localHost.tick).toBe(30);
    expect(replicaA.tick).toBe(30);
    expect(replicaB.tick).toBe(30);
    expect(compareSnapshots(serverHost.snapshot(), localHost.sim.snapshot()).ok).toBe(true);
    expect(getAllHives(localHost.state)).toEqual(getAllHives(serverHost.state));
    expect(getAllHives(replicaA.state)).toEqual(getAllHives(serverHost.state));
    expect(getAllHives(replicaB.state)).toEqual(getAllHives(serverHost.state));
    expect(getAllResidentBugs(replicaA.state)).toEqual(getAllResidentBugs(serverHost.state));
    expect(getAllResidentBugs(replicaB.state)).toEqual(getAllResidentBugs(localHost.state));
    expect(collectEntitySummary(replicaA.state)).toEqual(collectEntitySummary(serverHost.state));
    expect(collectEntitySummary(replicaB.state)).toEqual(collectEntitySummary(localHost.state));
    expect(syncA.confirmedDeaths.has(baitUnitId)).toBe(true);
    expect([...syncB.confirmedDeaths].sort((a, b) => a - b)).toEqual([...syncA.confirmedDeaths].sort((a, b) => a - b));
    expect(syncB.hpByEntityId).toEqual(syncA.hpByEntityId);

    localHost.stop();
    syncA.dispose();
    syncB.dispose();
  });
});

describe('W07-35 · 2. Terrain edits during an active fauna wave', () => {
  it('triggers bumpPathEpoch and deterministic path re-planning across server, local host, and client replicas', () => {
    const flags = parseWaves('..07');
    const data = createRegistryPipeline({ flags }).config.data;
    const baseState = createState({ planetId: 'pl-terrain-wave', planetType: 'temperate', seed: 'terrain-edit-wave', radius: 24 });
    baseState.grid.layers.terrain.fill(TERRAIN.flat);
    baseState.grid.layers.prep.fill(PREP.prepared);
    const col = ensureColonyRecord(baseState, 0, 0);
    col.status = 'active';
    col.stage = 3;
    col.threatStage = 3;
    const hqId = spawnHqUnit(baseState, { owner: 0, q: 0, r: 0 });
    const hiveId = spawnHiveEntity(baseState, { species: 'blackAnt', q: 9, r: 0, initialResidents: 4 }, 0, data);
    provokeHiveAgainstColony(baseState, hiveId, 0, 0, data);

    const { serverHost, localHost } = createDualHostsFromSnapshot('w07-terrain-wave', flags.list, encodeSnapshot(baseState));
    const serverEvents = attachEventCollector(serverHost);
    const replicaA = new ReplicaCore();
    const replicaB = new ReplicaCore();
    replicaA.welcome(makeWelcome(serverHost, flags.list));
    replicaB.welcome(makeWelcome(serverHost, flags.list));

    for (let t = 0; t < 3; t++) {
      stepServerLocalAndReplicas({
        serverHost,
        localHost,
        serverEvents,
        replicas: [{ replica: replicaA }, { replica: replicaB }],
        data,
      });
    }
    replicaA.markViewed();

    const cohort = getActiveCohorts(serverHost.state)[0]!;
    expect(cohort).toBeDefined();
    expect(cohort.targetEntityId).toBe(hqId);

    const hex = hexIndex(serverHost.state.grid.radius);
    const blockedTiles = [hex.indexOf(5, 0), hex.indexOf(5, -1), hex.indexOf(5, 1)];
    const gradedTile = hex.indexOf(4, 1);
    const epochBefore = serverHost.state.meta.pathEpoch ?? 0;

    for (const st of [serverHost.state, localHost.state]) {
      setTilePrep(st, blockedTiles[0]!, PREP.ridge);
      setTilePrep(st, blockedTiles[1]!, PREP.moat);
      setTilePrep(st, blockedTiles[2]!, PREP.ridge);
      setTilePrep(st, gradedTile, PREP.living);
    }

    expect(serverHost.state.meta.pathEpoch).toBeGreaterThan(epochBefore);
    expect(localHost.state.meta.pathEpoch).toBe(serverHost.state.meta.pathEpoch);

    for (let t = 0; t < 22; t++) {
      stepServerLocalAndReplicas({
        serverHost,
        localHost,
        serverEvents,
        replicas: [{ replica: replicaA }, { replica: replicaB }],
        data,
      });
      for (const bugId of cohort.memberIds) {
        const bRow = rowOf(serverHost.state.entities, bugId);
        const ti = hex.indexOf(serverHost.state.entities.cols.q[bRow]!, serverHost.state.entities.cols.r[bRow]!);
        expect(blockedTiles.includes(ti)).toBe(false);
      }
    }

    expect(replicaA.tilesChanged()).toBe(true);
    expect(replicaA.state.grid.layers.prep[blockedTiles[0]!]).toBe(PREP.ridge);
    expect(replicaB.state.grid.layers.prep[blockedTiles[1]!]).toBe(PREP.moat);
    expect(collectEntitySummary(localHost.state)).toEqual(collectEntitySummary(serverHost.state));
    expect(collectEntitySummary(replicaA.state)).toEqual(collectEntitySummary(serverHost.state));
    expect(collectEntitySummary(replicaB.state)).toEqual(collectEntitySummary(serverHost.state));
    for (const bugId of cohort.memberIds) {
      expect(getMotion(localHost.state, bugId)).toEqual(getMotion(serverHost.state, bugId));
      const bRow = rowOf(serverHost.state.entities, bugId);
      expect(hexDistance(serverHost.state.entities.cols.x[bRow]!, serverHost.state.entities.cols.y[bRow]!, 0, 0)).toBeLessThan(6);
    }
    localHost.stop();
  });
});

describe('W07-35 · 3. Late, duplicate, and missing/gapped directives', () => {
  it('ignores duplicates, pauses & recovers gaps from bounded replay log, and rolls back checkpoints on late directives', () => {
    const flags = parseWaves('..07');
    const pipeline = createRegistryPipeline({ flags });
    const data = pipeline.config.data;
    const makeState = () => {
      const s = createState({ planetId: 'pl-dir', planetType: 'temperate', seed: 'dir-parity-seed', radius: 24 });
      s.grid.layers.terrain.fill(TERRAIN.flat);
      s.grid.layers.prep.fill(PREP.prepared);
      ensureColonyRecord(s, 0, 0).status = 'active';
      spawnHiveEntity(s, { species: 'blackAnt', q: 0, r: 0, initialResidents: 2 }, 0, data);
      spawnColonyUnit(s, { kind: ENTITY_KIND.harvester, owner: 0, q: 9, r: 0, hp: 300 });
      return s;
    };

    const authHost = new SimHost(pipeline);
    const gapHost = new SimHost(pipeline);
    const lateHost = new SimHost(pipeline);
    authHost.load(makeState());
    gapHost.load(makeState());
    lateHost.load(makeState());

    const gapSync = new CombatSyncController();
    const lateSync = new CombatSyncController();

    authHost.step(5);
    gapHost.step(5);
    lateHost.step(5);
    lateSync.fauna.checkpoint(lateHost.state);

    const hiveId = getAllHives(authHost.state)[0]!.hiveId;
    const d1 = emitFaunaDirective(authHost.state, {
      effectiveTick: 5, hiveId, decisionIndex: nextFaunaGameplayRng(authHost.state, hiveId, 5).decisionIndex,
      kind: 'spawn', payload: { species: 'blackAnt', bugId: 301, q: 1, r: 0 },
    });
    const d2 = emitFaunaDirective(authHost.state, {
      effectiveTick: 5, hiveId, decisionIndex: nextFaunaGameplayRng(authHost.state, hiveId, 5).decisionIndex,
      kind: 'mode', payload: { mode: 'aggressive', targetColony: 0 },
    });
    const d3 = emitFaunaDirective(authHost.state, {
      effectiveTick: 5, hiveId, decisionIndex: nextFaunaGameplayRng(authHost.state, hiveId, 5).decisionIndex,
      kind: 'spawn', payload: { species: 'blackAnt', bugId: 302, q: 0, r: 1 },
    });
    const d4 = emitFaunaDirective(authHost.state, {
      effectiveTick: 5, hiveId, decisionIndex: nextFaunaGameplayRng(authHost.state, hiveId, 5).decisionIndex,
      kind: 'cohortDispatch',
      payload: { cohortId: 'cohort:dir:1', species: 'blackAnt', memberIds: [301, 302], targetColony: 0, objectiveQ: 9, objectiveR: 0 },
    });

    expect(gapSync.applyFaunaDirective(gapHost.state, d1, { data }).status).toBe('applied');
    expect(gapSync.applyFaunaDirective(gapHost.state, d1, { data }).status).toBe('duplicate_ignored');
    expect(gapSync.fauna.duplicateDirectivesIgnored).toBe(1);
    expect(gapSync.applyFaunaDirective(gapHost.state, d2, { data }).status).toBe('applied');
    expect(gapSync.applyFaunaDirective(gapHost.state, d4, { data })).toMatchObject({
      status: 'gap_detected', missingFromSeq: 3, missingToSeq: 3,
    });
    expect(getFaunaDirectivesState(gapHost.state).predictionPaused).toBe(true);

    const replay = getFaunaDirectivesSince(authHost.state, 2);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      const rec = gapSync.applyFaunaDirective(gapHost.state, replay.directives[0]!, { data });
      expect(rec).toEqual({ status: 'applied', appliedSeqs: [3, 4] });
    }
    expect(getFaunaDirectivesState(gapHost.state).predictionPaused).toBe(false);

    lateSync.applyFaunaDirectives(lateHost.state, [d1, d2, d3], { data });
    authHost.step(7);
    gapHost.step(7);
    lateHost.step(7);

    const lateRes = lateSync.applyFaunaDirective(lateHost.state, d4, {
      data,
      onStepToTick: (_s, targetTick) => { lateHost.step(targetTick - lateHost.tick); },
    });
    expect(lateRes.status).toBe('replayed_from_checkpoint');
    expect(lateHost.tick).toBe(12);
    expect(collectEntitySummary(gapHost.state)).toEqual(collectEntitySummary(authHost.state));
    expect(collectEntitySummary(lateHost.state)).toEqual(collectEntitySummary(authHost.state));
    expect(getResidentBugRecord(lateHost.state, 301)?.cohortId).toBe('cohort:dir:1');

    gapSync.dispose();
    lateSync.dispose();
  });
});

describe('W07-35 · 4. Mid-wave client reconnect and server mid-wave snapshot save/restart', () => {
  it('preserves active cohort, RNG counters, and in-flight acid projectiles across mid-wave restart and welcome resync', () => {
    const { initialBytes, flags, data, spitterHiveId, baitUnitId } = buildW07ParitySeedState('mid-wave-restart-seed');
    const origHost = new SimHost(createRegistryPipeline({ flags }));
    origHost.load(decodeSnapshot(initialBytes));

    const bugIds = [...getHiveRecord(origHost.state, spitterHiveId)!.residentIds];
    const { decisionIndex } = nextFaunaGameplayRng(origHost.state, spitterHiveId, origHost.tick);
    emitFaunaDirective(origHost.state, {
      effectiveTick: origHost.tick,
      hiveId: spitterHiveId,
      decisionIndex,
      kind: 'cohortDispatch',
      payload: {
        cohortId: 'cohort:spitter:midwave',
        species: 'greenSpitter',
        memberIds: bugIds,
        targetColony: 0,
        targetEntityId: baitUnitId,
        objectiveQ: 3,
        objectiveR: 0,
      },
    });
    origHost.step(2);
    fireProjectile(origHost.state, {
      attackerId: bugIds[0]!,
      attackerOwner: -1,
      targetId: baitUnitId,
      weaponId: 'spitterAcid',
      weaponKind: 'acid',
      damage: 12,
      speed: 1.5,
      tick: origHost.tick,
    });
    expect(getPendingProjectileImpacts(origHost.state).length).toBeGreaterThan(0);

    const midSnapshotBytes = encodeSnapshot(origHost.state);
    const restartedHost = new SimHost(createRegistryPipeline({ flags }));
    restartedHost.load(decodeSnapshot(midSnapshotBytes));

    const reconnectedReplica = new ReplicaCore();
    const reconnectedSync = new CombatSyncController(new THREE.Scene());
    expect(reconnectedReplica.welcome(makeWelcome(restartedHost, flags.list))).toEqual({ ok: true });
    reconnectedSync.syncPlanetState(reconnectedReplica.state);

    expect(getPendingProjectileImpacts(restartedHost.state)).toEqual(getPendingProjectileImpacts(origHost.state));
    expect(Array.from(restartedHost.state.rng.fauna)).toEqual(Array.from(origHost.state.rng.fauna));
    expect(getFaunaDirectivesState(restartedHost.state).lastSeq).toBe(getFaunaDirectivesState(origHost.state).lastSeq);

    const restartedEvents = attachEventCollector(restartedHost);
    for (let i = 0; i < 18; i++) {
      origHost.step(1);
      drainFaunaDirectivesOutbox(origHost.state);
      buildFaunaSparseCorrection(origHost.state, origHost.tick);
      stepServerLocalAndReplicas({
        serverHost: restartedHost,
        serverEvents: restartedEvents,
        replicas: [{ replica: reconnectedReplica, sync: reconnectedSync }],
        data,
      });
    }

    expect(compareSnapshots(origHost.snapshot(), restartedHost.snapshot()).ok).toBe(true);
    expect(collectEntitySummary(reconnectedReplica.state)).toEqual(collectEntitySummary(origHost.state));
    expect(reconnectedSync.confirmedDeaths.has(baitUnitId)).toBe(true);
    reconnectedSync.dispose();
  });
});

describe('W07-35 · 5. predict=0 vs predict=1 convergence', () => {
  it('converges on identical confirmed state and spawns zero duplicate projectile/impact VFX', () => {
    const { initialBytes, flags, reconId, spitterHiveId } = buildW07ParitySeedState('predict-0-vs-1');
    const serverHost = new SimHost(createRegistryPipeline({ flags }));
    serverHost.load(decodeSnapshot(initialBytes));

    let clockMs = 10_000;
    const predOff = new Predictor(new ReplicaCore(), { now: () => clockMs, enabled: false });
    const predOn = new Predictor(new ReplicaCore(), { now: () => clockMs, enabled: true });
    const syncOff = new CombatSyncController(new THREE.Scene());
    const syncOn = new CombatSyncController(new THREE.Scene());

    const welcome = { ...makeWelcome(serverHost, flags.list), serverTimeMs: clockMs };
    expect(predOff.welcome(welcome)).toEqual({ ok: true });
    expect(predOn.welcome(welcome)).toEqual({ ok: true });

    const serverEvents = attachEventCollector(serverHost);
    const cmd = { id: 'pred-attack', kind: 'attackTarget', args: { entityId: reconId, targetId: spitterHiveId }, sentAtMs: clockMs };
    predOff.submit(cmd);
    predOn.submit(cmd);
    expect(predOff.tick).toBe(0);
    expect(predOn.tick).toBeGreaterThan(0);
    syncOff.ingestCombatEvents(predOff.takeRenderEvents());
    syncOn.ingestCombatEvents(predOn.takeRenderEvents());

    serverHost.submit({ colonyIndex: 0, source: 'player', commandId: cmd.id, kind: cmd.kind, args: cmd.args });

    for (let step = 1; step <= 20; step++) {
      clockMs += TICK_MS;
      const from = serverHost.tick;
      serverEvents.length = 0;
      serverHost.step(1);

      if (step === 1) {
        predOff.onAck(cmd.id, 1);
        predOn.onAck(cmd.id, 1);
      }

      const preViewOn = unpackView(packView(predOn.view(), false).view);
      syncOn.ingestCombatEvents(predOn.takeRenderEvents());
      syncOn.syncView(preViewOn);

      const diff = serverHost.diffSince(from, { forClient: true });
      expect(predOff.onDelta({ fromTick: from, toTick: serverHost.tick, diff }).ok).toBe(true);
      expect(predOn.onDelta({ fromTick: from, toTick: serverHost.tick, diff }).ok).toBe(true);

      syncOff.ingestCombatEvents(serverEvents);
      syncOn.ingestCombatEvents(serverEvents);
      syncOff.syncView(unpackView(packView(predOff.view(), false).view));
      syncOn.syncView(unpackView(packView(predOn.view(), false).view));
    }

    expect(predOn.pending).toHaveLength(0);
    expect(predOff.tick).toBe(serverHost.tick);
    expect(predOn.tick).toBe(serverHost.tick);
    expect(collectEntitySummary(predOff.confirmed.state)).toEqual(collectEntitySummary(predOn.confirmed.state));
    expect(syncOn.vfxFiredSpawnCount).toBeGreaterThan(0);
    expect(syncOn.vfxFiredSpawnCount).toBe(syncOff.vfxFiredSpawnCount);
    expect(syncOn.vfxImpactSpawnCount).toBe(syncOff.vfxImpactSpawnCount);
    expect(syncOn.duplicateFiredIgnored).toBeGreaterThan(0);
    expect(syncOn.firedHistory).toEqual(syncOff.firedHistory);
    expect(syncOn.impactHistory).toEqual(syncOff.impactHistory);
    expect(syncOn.hpByEntityId).toEqual(syncOff.hpByEntityId);

    syncOff.dispose();
    syncOn.dispose();
  });
});

describe('W07-35 · 6. TA_WAVES wave gating (..06 vs ..07)', () => {
  it('disables faunaHives, faunaSystem, and W07 combat commands under ..06 and enables them under ..07', () => {
    const flags06 = parseWaves('..06');
    const host06 = new SimHost(createRegistryPipeline({ flags: flags06 }));
    const planet06 = createPlanet({ id: 'pl-gate-06', seed: 'ta-waves-gate', type: 'temperate', planetType: 'temperate', radius: 56 });
    ensureColonyRecord(planet06, 0, 0).status = 'active';
    const unit06 = spawnColonyUnit(planet06, { kind: ENTITY_KIND.harvester, owner: 0, q: 0, r: 0, hp: 200 });
    host06.load(planet06);

    const outcomes06: Record<string, string | undefined> = {};
    host06.onOutcomes((outs) => {
      for (const o of outs) outcomes06[o.commandId] = o.code;
    });

    const w07Commands: Array<{ id: string; kind: string; args: Record<string, unknown> }> = [
      { id: 'c-stance', kind: 'setStance', args: { entityId: unit06, stance: 'hold' } },
      { id: 'c-rally', kind: 'setRally', args: { q: 2, r: 0 } },
      { id: 'c-amove', kind: 'attackMove', args: { entityId: unit06, q: 3, r: 0 } },
      { id: 'c-atarget', kind: 'attackTarget', args: { entityId: unit06, targetId: unit06 } },
    ];

    for (const c of w07Commands) {
      const pre = precheckClientCommand(c.kind, c.args, {
        gate: (k) => commandGate(k, flags06),
        production: false,
        hasColony: true,
      });
      expect(pre).toEqual({ ok: false, code: 'wave_disabled' });
      host06.submit({ colonyIndex: 0, source: 'player', commandId: c.id, kind: c.kind, args: c.args });
    }

    host06.step(10);
    expect(host06.state.blobs.faunaHives).toBeUndefined();
    expect(getAllHives(host06.state)).toHaveLength(0);
    expect(getAllResidentBugs(host06.state)).toHaveLength(0);
    for (const c of w07Commands) {
      expect(outcomes06[c.id]).toBe('wave_disabled');
    }

    const flags07 = parseWaves('..07');
    const host07 = new SimHost(createRegistryPipeline({ flags: flags07 }));
    const planet07 = createPlanet({ id: 'pl-gate-07', seed: 'ta-waves-gate', type: 'temperate', planetType: 'temperate', radius: 56 });
    ensureColonyRecord(planet07, 0, 0).status = 'active';
    const recon07 = spawnColonyUnit(planet07, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 240 });
    host07.load(planet07);
    host07.step(2);

    const hives07 = getAllHives(host07.state);
    expect(hives07.length).toBeGreaterThanOrEqual(3);
    expect(getAllResidentBugs(host07.state).length).toBeGreaterThan(0);

    const outcomes07: Record<string, string | undefined> = {};
    host07.onOutcomes((outs) => {
      for (const o of outs) outcomes07[o.commandId] = o.code;
    });

    const validW07Cmds: Array<{ id: string; kind: string; args: Record<string, unknown> }> = [
      { id: 'ok-stance', kind: 'setStance', args: { entityId: recon07, stance: 'hunt' } },
      { id: 'ok-rally', kind: 'setRally', args: { q: 2, r: 0 } },
      { id: 'ok-amove', kind: 'attackMove', args: { entityId: recon07, q: 3, r: 0 } },
      { id: 'ok-atarget', kind: 'attackTarget', args: { entityId: recon07, targetId: hives07[0]!.hiveId } },
    ];
    for (const c of validW07Cmds) {
      const pre = precheckClientCommand(c.kind, c.args, {
        gate: (k) => commandGate(k, flags07),
        production: false,
        hasColony: true,
      });
      expect(pre.ok).toBe(true);
      host07.submit({ colonyIndex: 0, source: 'player', commandId: c.id, kind: c.kind, args: c.args });
    }
    host07.step(1);
    for (const c of validW07Cmds) {
      expect(outcomes07[c.id]).toBeUndefined();
    }
  });
});
