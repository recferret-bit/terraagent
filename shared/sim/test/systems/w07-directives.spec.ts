import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyDamage,
  applyFaunaDirective,
  applyFaunaSparseCorrection,
  buildFaunaSparseCorrection,
  computeFaunaRowChangedMask,
  createFaunaCheckpoint,
  createFaunaCheckpointStore,
  createRegistryPipeline,
  createState,
  decodeSnapshot,
  drainFaunaDirectivesOutbox,
  emitFaunaDirective,
  encodeSnapshot,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  FAUNA_CORRECTION_INTERVAL_TICKS,
  FAUNA_DIFF_MASK,
  FAUNA_DIRECTIVE_VERSION,
  FaunaReplicaController,
  fireProjectile,
  getAllHives,
  getAllResidentBugs,
  getFaunaDirectivesSince,
  getFaunaDirectivesState,
  getHiveRecord,
  getPendingProjectileImpacts,
  getResidentBugRecord,
  getUnitCommand,
  hexDistance,
  insertRow,
  MAX_DIRECTIVE_LOG,
  nextFaunaGameplayRng,
  nextInt,
  placeSpawnedEntity,
  PREP,
  restoreFaunaCheckpoint,
  rowOf,
  sampleFaunaCosmeticActivity,
  shouldOmitFaunaTransformFromRoutineDiff,
  SimHost,
  spawnHiveEntity,
  TERRAIN,
  type FaunaDirective,
  type PlanetState,
} from '../../src';

function createW07TestHost(seed = 'w07-directives-seed', radius = 24) {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-w07-dir', planetType: 'temperate', seed, radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  ensureColonyRecord(state, 0, 0).status = 'active';
  ensureColonyRecord(state, 1, 0).status = 'active';
  host.load(state);
  return { host, state, data: pipeline.config.data };
}

function spawnTestBuilding(state: PlanetState, owner: number, q: number, r: number, hp = 400): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.solar;
  cols.owner[row] = owner;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}

function runDeterministicDirectiveScenario() {
  const { host, state, data } = createW07TestHost('equal-inputs-seed');
  const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 0, r: 0, initialResidents: 3 }, 0, data);
  const targetId = spawnTestBuilding(state, 0, 7, 0);

  host.step(5);
  const { rng: rng1, decisionIndex: dec1 } = nextFaunaGameplayRng(state, hiveId, host.tick);
  const spawnOffset = nextInt(rng1, 0, 1);
  emitFaunaDirective(state, {
    effectiveTick: host.tick,
    hiveId,
    decisionIndex: dec1,
    kind: 'spawn',
    payload: { species: 'blackAnt', bugId: 200, q: 1 + spawnOffset, r: 0 },
  });

  host.step(5);
  const { decisionIndex: dec2 } = nextFaunaGameplayRng(state, hiveId, host.tick);
  emitFaunaDirective(state, {
    effectiveTick: host.tick,
    hiveId,
    decisionIndex: dec2,
    kind: 'mode',
    payload: { mode: 'aggressive', targetColony: 0, reason: 'provoked' },
  });

  const members = getHiveRecord(state, hiveId)!.residentIds.slice(0, 3);
  const { decisionIndex: dec3 } = nextFaunaGameplayRng(state, hiveId, host.tick);
  emitFaunaDirective(state, {
    effectiveTick: host.tick,
    hiveId,
    decisionIndex: dec3,
    kind: 'cohortDispatch',
    payload: {
      cohortId: `cohort:${hiveId}:1`,
      species: 'blackAnt',
      memberIds: members,
      targetColony: 0,
      targetEntityId: targetId,
      objectiveQ: 7,
      objectiveR: 0,
    },
  });

  host.step(10);
  return {
    directives: getFaunaDirectivesState(state).log,
    rngFauna: Array.from(state.rng.fauna),
    hiveDec: getHiveRecord(state, hiveId)!.decisionIndex,
    bugs: getAllResidentBugs(state).map((b) => {
      const r = rowOf(state.entities, b.entityId);
      return { id: b.entityId, x: state.entities.cols.x[r], y: state.entities.cols.y[r], mode: b.mode };
    }),
  };
}

describe('W07-33 · Equal accepted inputs and RNG isolation', () => {
  it('produces identical fauna directives, hive decision indices, and RNG states from equal accepted inputs + seed', () => {
    const runA = runDeterministicDirectiveScenario();
    const runB = runDeterministicDirectiveScenario();
    expect(runA.directives).toEqual(runB.directives);
    expect(runA.rngFauna).toEqual(runB.rngFauna);
    expect(runA.hiveDec).toBe(runB.hiveDec);
    expect(runA.bugs).toEqual(runB.bugs);
  });

  it('keeps gameplay directive RNG counters completely unchanged when cosmetic/presentation RNG is sampled', () => {
    const { host: hostA, state: stateA, data: dataA } = createW07TestHost('cosmetic-isolation');
    const { host: hostB, state: stateB, data: dataB } = createW07TestHost('cosmetic-isolation');
    const hiveA = spawnHiveEntity(stateA, { species: 'greenSpitter', q: 0, r: 0, initialResidents: 3 }, 0, dataA);
    const hiveB = spawnHiveEntity(stateB, { species: 'greenSpitter', q: 0, r: 0, initialResidents: 3 }, 0, dataB);

    for (let t = 1; t <= 20; t++) {
      hostA.step(1);
      hostB.step(1);
      for (let i = 0; i < 40; i++) {
        const sample = sampleFaunaCosmeticActivity(stateB.meta.seed, hiveB, 10 + i, t);
        expect(['idle', 'foraging', 'resting', 'grooming', 'carrying', 'tending']).toContain(sample.activity);
      }
      if (t % 5 === 0) {
        const { rng: rA, decisionIndex: dA } = nextFaunaGameplayRng(stateA, hiveA, t);
        const { rng: rB, decisionIndex: dB } = nextFaunaGameplayRng(stateB, hiveB, t);
        expect(dA).toBe(dB);
        expect(nextInt(rA, 0, 1000)).toBe(nextInt(rB, 0, 1000));
      }
    }
    expect(Array.from(stateA.rng.fauna)).toEqual(Array.from(stateB.rng.fauna));
    expect(getHiveRecord(stateA, hiveA)?.decisionIndex).toBe(getHiveRecord(stateB, hiveB)?.decisionIndex);
  });
});

describe('W07-33 · Duplicate directive idempotency and bounded log version checks', () => {
  it('ignores duplicate directives idempotently (status === duplicate_ignored) without duplicating bugs or cohorts', () => {
    const { state: server, data } = createW07TestHost('dup-seed');
    const { state: replica } = createW07TestHost('dup-seed');
    const hiveId = spawnHiveEntity(server, { species: 'blackAnt', q: 0, r: 0, initialResidents: 2 }, 0, data);
    spawnHiveEntity(replica, { species: 'blackAnt', q: 0, r: 0, initialResidents: 2 }, 0, data);

    const spawnDir = emitFaunaDirective(server, {
      effectiveTick: 5,
      hiveId,
      decisionIndex: 1,
      kind: 'spawn',
      payload: { species: 'blackAnt', bugId: 77, q: 1, r: 0 },
    });
    const dispatchDir = emitFaunaDirective(server, {
      effectiveTick: 6,
      hiveId,
      decisionIndex: 2,
      kind: 'cohortDispatch',
      payload: { cohortId: 'cohort:1:2', species: 'blackAnt', memberIds: [77], targetColony: 0, objectiveQ: 6, objectiveR: 0 },
    });

    expect(drainFaunaDirectivesOutbox(server)).toHaveLength(2);
    expect(drainFaunaDirectivesOutbox(server)).toHaveLength(0);

    replica.meta.tick = 5;
    expect(applyFaunaDirective(replica, spawnDir).status).toBe('applied');
    const bugCountAfterFirst = getAllResidentBugs(replica).length;
    expect(applyFaunaDirective(replica, spawnDir).status).toBe('duplicate_ignored');
    expect(getAllResidentBugs(replica)).toHaveLength(bugCountAfterFirst);
    expect(getHiveRecord(replica, hiveId)?.residentIds.filter((id) => id === 77)).toHaveLength(1);

    replica.meta.tick = 6;
    expect(applyFaunaDirective(replica, dispatchDir).status).toBe('applied');
    expect(applyFaunaDirective(replica, dispatchDir).status).toBe('duplicate_ignored');
    expect(getHiveRecord(replica, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(1);
    expect(Object.keys(getFaunaDirectivesState(replica).cohortsById)).toEqual(['cohort:1:2']);
  });

  it('rejects incompatible directive versions and reports log_gap when bounded log trims old entries', () => {
    const { state, data } = createW07TestHost('version-and-trim');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 0, r: 0, initialResidents: 1 }, 0, data);
    const badDirective: FaunaDirective = {
      version: FAUNA_DIRECTIVE_VERSION + 99,
      seq: 1,
      effectiveTick: 1,
      hiveId,
      decisionIndex: 1,
      kind: 'mode',
      payload: { mode: 'aggressive', targetColony: 0 },
    };
    expect(applyFaunaDirective(state, badDirective).status).toBe('version_mismatch');

    for (let i = 0; i < MAX_DIRECTIVE_LOG + 10; i++) {
      emitFaunaDirective(state, {
        effectiveTick: i + 1,
        hiveId,
        decisionIndex: i + 1,
        kind: 'mode',
        payload: { mode: i % 2 === 0 ? 'aggressive' : 'passive', targetColony: 0 },
      });
    }
    const blob = getFaunaDirectivesState(state);
    expect(blob.log).toHaveLength(MAX_DIRECTIVE_LOG);
    expect(blob.log[0]?.seq).toBe(11);
    expect(getFaunaDirectivesSince(state, 5)).toEqual({ ok: false, reason: 'log_gap', earliestSeq: 11 });
  });
});

describe('W07-33 · Gapped directive recovery', () => {
  it('recovers cleanly from gapped directives (seq jumps from 2 to 4, then 3 arrives or replays from bounded log)', () => {
    const { state: server, data } = createW07TestHost('gap-seed');
    const { state: replicaA } = createW07TestHost('gap-seed');
    const { state: replicaB } = createW07TestHost('gap-seed');
    const hiveId = spawnHiveEntity(server, { species: 'blueBeetle', q: 0, r: 0, initialResidents: 1 }, 0, data);
    spawnHiveEntity(replicaA, { species: 'blueBeetle', q: 0, r: 0, initialResidents: 1 }, 0, data);
    spawnHiveEntity(replicaB, { species: 'blueBeetle', q: 0, r: 0, initialResidents: 1 }, 0, data);

    const d1 = emitFaunaDirective(server, {
      effectiveTick: 2,
      hiveId,
      decisionIndex: 1,
      kind: 'spawn',
      payload: { species: 'blueBeetle', bugId: 101, q: 1, r: 0 },
    });
    const d2 = emitFaunaDirective(server, {
      effectiveTick: 4,
      hiveId,
      decisionIndex: 2,
      kind: 'mode',
      payload: { mode: 'aggressive', targetColony: 0 },
    });
    const d3 = emitFaunaDirective(server, {
      effectiveTick: 6,
      hiveId,
      decisionIndex: 3,
      kind: 'spawn',
      payload: { species: 'blueBeetle', bugId: 102, q: 0, r: 1 },
    });
    const d4 = emitFaunaDirective(server, {
      effectiveTick: 8,
      hiveId,
      decisionIndex: 4,
      kind: 'cohortDispatch',
      payload: { cohortId: 'cohort:beetle:1', species: 'blueBeetle', memberIds: [101, 102], targetColony: 0, objectiveQ: 5, objectiveR: 0 },
    });

    replicaA.meta.tick = 8;
    expect(applyFaunaDirective(replicaA, d1).status).toBe('applied');
    expect(applyFaunaDirective(replicaA, d2).status).toBe('applied');
    expect(applyFaunaDirective(replicaA, d4).status).toBe('gap_detected');
    expect(getFaunaDirectivesState(replicaA).predictionPaused).toBe(true);

    const recRes = applyFaunaDirective(replicaA, d3);
    expect(recRes.status).toBe('applied');
    expect(recRes.appliedSeqs).toEqual([3, 4]);
    expect(getFaunaDirectivesState(replicaA).predictionPaused).toBe(false);
    expect(getHiveRecord(replicaA, hiveId)?.residentIds.filter((id) => id === 102)).toHaveLength(1);

    replicaB.meta.tick = 8;
    applyFaunaDirective(replicaB, d1);
    applyFaunaDirective(replicaB, d2);
    const since2 = getFaunaDirectivesSince(server, 2);
    expect(since2.ok).toBe(true);
    if (since2.ok) {
      expect(applyFaunaDirective(replicaB, d4, { sourceLog: since2.directives }).status).toBe('applied');
    }
    expect(getAllResidentBugs(replicaB).map((b) => b.entityId)).toEqual(getAllResidentBugs(replicaA).map((b) => b.entityId));
  });
});

describe('W07-33 · Late directive checkpoint recovery', () => {
  it('restores from checkpoint and replays at the original effectiveTick when a late directive arrives', () => {
    const { host: authHost, state: authState, data } = createW07TestHost('late-directive-seed');
    const { host: repHost, state: repState } = createW07TestHost('late-directive-seed');
    const controller = new FaunaReplicaController();

    const hiveId = spawnHiveEntity(authState, { species: 'blackAnt', q: 0, r: 0, initialResidents: 2 }, 0, data);
    spawnHiveEntity(repState, { species: 'blackAnt', q: 0, r: 0, initialResidents: 2 }, 0, data);

    authHost.step(5);
    repHost.step(5);
    controller.checkpoint(repState);

    const bugIds = [...getHiveRecord(authState, hiveId)!.residentIds];
    const dispatchAt5 = emitFaunaDirective(authState, {
      effectiveTick: 5,
      hiveId,
      decisionIndex: 1,
      kind: 'cohortDispatch',
      payload: { cohortId: 'cohort:late:1', species: 'blackAnt', memberIds: bugIds, targetColony: 0, objectiveQ: 10, objectiveR: 0 },
    });

    for (let t = 0; t < 10; t++) {
      authHost.step(1);
      repHost.step(1);
    }
    const bug0 = bugIds[0]!;
    const authXAt15 = authState.entities.cols.x[rowOf(authState.entities, bug0)]!;
    const repXBeforeReplay = repState.entities.cols.x[rowOf(repState.entities, bug0)]!;
    expect(Math.abs(authXAt15 - repXBeforeReplay)).toBeGreaterThan(0.5);

    const res = controller.applyDirective(repState, dispatchAt5);
    expect(res.status).toBe('replayed_from_checkpoint');
    expect(repState.meta.tick).toBe(15);
    expect(repState.entities.cols.x[rowOf(repState.entities, bug0)]!).toBeCloseTo(authXAt15, 4);
    expect(getUnitCommand(repState, bug0)?.kind).toBe('move');
  });
});

describe('W07-33 · Mid-wave snapshot save and reload', () => {
  it('preserves hive state, RNG counters, faunaDirectives.lastSeq, and pending projectileImpacts across mid-wave snapshot save/reload', () => {
    const { host, state, data } = createW07TestHost('mid-wave-snapshot');
    const hiveId = spawnHiveEntity(state, { species: 'greenSpitter', q: -6, r: 0, initialResidents: 2 }, 0, data);
    const targetId = spawnTestBuilding(state, 0, -2, 0, 500);

    host.step(4);
    const bugIds = [...getHiveRecord(state, hiveId)!.residentIds];
    const { decisionIndex } = nextFaunaGameplayRng(state, hiveId, host.tick);
    emitFaunaDirective(state, {
      effectiveTick: host.tick,
      hiveId,
      decisionIndex,
      kind: 'cohortDispatch',
      payload: {
        cohortId: 'cohort:spitter:wave1',
        species: 'greenSpitter',
        memberIds: bugIds,
        targetColony: 0,
        targetEntityId: targetId,
        objectiveQ: -2,
        objectiveR: 0,
      },
    });

    const impactEntry = fireProjectile(state, {
      attackerId: bugIds[0]!,
      attackerOwner: -1,
      targetId,
      weaponId: 'spitterAcid',
      weaponKind: 'acid',
      damage: 12,
      speed: 2,
      tick: host.tick,
    });
    expect(getPendingProjectileImpacts(state)).toHaveLength(1);

    const reloaded = decodeSnapshot(encodeSnapshot(state));
    expect(getAllHives(reloaded)).toEqual(getAllHives(state));
    expect(Array.from(reloaded.rng.fauna)).toEqual(Array.from(state.rng.fauna));
    expect(getFaunaDirectivesState(reloaded).lastSeq).toBe(getFaunaDirectivesState(state).lastSeq);
    expect(getPendingProjectileImpacts(reloaded)).toEqual(getPendingProjectileImpacts(state));

    const reloadedHost = new SimHost(host.pipeline);
    reloadedHost.load(reloaded);
    const remainingTicks = impactEntry.impactTick - host.tick + 2;
    host.step(remainingTicks);
    reloadedHost.step(remainingTicks);

    expect(getPendingProjectileImpacts(state).some((p) => p.id === impactEntry.id)).toBe(false);
    expect(getPendingProjectileImpacts(reloadedHost.state)).toEqual(getPendingProjectileImpacts(state));
    expect(reloadedHost.state.entities.cols.hp[rowOf(reloadedHost.state.entities, targetId)]).toBe(
      state.entities.cols.hp[rowOf(state.entities, targetId)],
    );
  });
});

describe('W07-33 · Routine diff transform suppression and 5-second sparse corrections', () => {
  it('suppresses per-tick fauna motion transforms on non-correction ticks while preserving HP/state/spawn and 5s sparse corrections', () => {
    const motionMask = computeFaunaRowChangedMask(
      { x: 1.0, y: 0.0, rot: 0, q: 1, r: 0, hp: 120, state: ENTITY_STATE.moving },
      { x: 1.4, y: 0.0, rot: 0.2, q: 1, r: 0, hp: 120, state: ENTITY_STATE.moving },
    );
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.blackAnt, motionMask, 7)).toBe(true);
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.blueBeetle, motionMask, 13)).toBe(true);
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.greenSpitter, motionMask, 24)).toBe(true);
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.recon, motionMask, 7)).toBe(false);
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.blackAnt, motionMask, FAUNA_CORRECTION_INTERVAL_TICKS)).toBe(false);
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.blackAnt, motionMask | FAUNA_DIFF_MASK.hp, 7)).toBe(false);
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.blackAnt, motionMask | FAUNA_DIFF_MASK.state, 7)).toBe(false);
    expect(shouldOmitFaunaTransformFromRoutineDiff(ENTITY_KIND.blackAnt, motionMask | FAUNA_DIFF_MASK.spawn, 7)).toBe(false);

    const { host, state, data } = createW07TestHost('sparse-corr-seed');
    const { state: replica } = createW07TestHost('sparse-corr-seed');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 0, r: 0, initialResidents: 2 }, 0, data);
    spawnHiveEntity(replica, { species: 'blackAnt', q: 0, r: 0, initialResidents: 2 }, 0, data);

    for (let t = 1; t < FAUNA_CORRECTION_INTERVAL_TICKS; t++) {
      host.step(1);
      expect(buildFaunaSparseCorrection(state, state.meta.tick)).toBeNull();
    }
    host.step(1);
    const bugId = getHiveRecord(state, hiveId)!.residentIds[0]!;
    applyDamage(state, bugId, 25, { tick: state.meta.tick });

    const corr = buildFaunaSparseCorrection(state, state.meta.tick)!;
    expect(corr.tick).toBe(25);
    expect(applyFaunaSparseCorrection(replica, corr, data).reconciledCount).toBe(corr.bugs.length);

    const authRow = rowOf(state.entities, bugId);
    const repRow = rowOf(replica.entities, bugId);
    expect(replica.entities.cols.hp[repRow]).toBeCloseTo(state.entities.cols.hp[authRow]!, 4);
    expect(
      hexDistance(
        replica.entities.cols.x[repRow]!,
        replica.entities.cols.y[repRow]!,
        state.entities.cols.x[authRow]!,
        state.entities.cols.y[authRow]!,
      ),
    ).toBeLessThan(1e-4);

    const dTarget = emitFaunaDirective(state, {
      effectiveTick: 26,
      hiveId,
      decisionIndex: 5,
      kind: 'targetChange',
      payload: { memberIds: [bugId], targetColony: 0, objectiveQ: 4, objectiveR: -2 },
    });
    const dReturn = emitFaunaDirective(state, {
      effectiveTick: 27,
      hiveId,
      decisionIndex: 6,
      kind: 'cohortReturn',
      payload: { memberIds: [bugId], mode: 'passive', objectiveQ: 1, objectiveR: 0 },
    });
    replica.meta.tick = 27;
    expect(applyFaunaDirective(replica, dTarget).status).toBe('applied');
    expect(applyFaunaDirective(replica, dReturn).status).toBe('applied');
    expect(getResidentBugRecord(replica, bugId)?.mode).toBe('passive');

    const store = createFaunaCheckpointStore();
    const cp = createFaunaCheckpoint(replica, store);
    expect(store.getExact(27)?.tick).toBe(27);
    restoreFaunaCheckpoint(replica, cp);
    expect(getResidentBugRecord(replica, bugId)?.mode).toBe('passive');
  });
});
