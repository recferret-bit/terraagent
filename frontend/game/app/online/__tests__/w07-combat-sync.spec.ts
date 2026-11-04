import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseWaves, type SimEventWire } from '@terra/contracts';
import type { HexTerrain } from '@terra/render/planets/hex';
import {
  applyDamage,
  buildFaunaSparseCorrection,
  createRegistryPipeline,
  createState,
  decodeSnapshot,
  drainFaunaDirectivesOutbox,
  emitFaunaDirective,
  encodeSnapshot,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getAllResidentBugs,
  getFaunaDirectivesState,
  getHiveRecord,
  insertRow,
  nextFaunaGameplayRng,
  placeSpawnedEntity,
  PREP,
  SimHost,
  spawnHiveEntity,
  TERRAIN,
  type FaunaDirective,
  type FaunaSparseCorrection,
  type PlanetState,
} from '@terra/sim';
import { packView, unpackView } from '../../../store/replica/viewCodec';
import {
  bindStoreCombatEvents,
  canonicalProjectileFiredKey,
  canonicalProjectileImpactKey,
  CombatSyncController,
  ingestHostMessageCombatEvents,
} from '../combatSync';
import {
  archetypeForKind,
  computeWorkTarget,
  entityGroundY,
  is2x2BuildingKind,
  is3x3FootprintKind,
  isConstructibleBuilding,
  isTrackedWalkingUnitKind,
} from '../entityKinds';
import { EntityMeshes } from '../EntityMeshes';

function createSpitterEncounterHost(seed = 'w07-spitter-combat-sync') {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-w07-sync', planetType: 'temperate', seed, radius: 24 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  ensureColonyRecord(state, 0, 0).status = 'active';
  host.load(state);
  return { host, state, data: pipeline.config.data };
}

function spawnTargetUnit(
  state: PlanetState,
  opts: { kind: number; owner: number; q: number; r: number; hp: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp;
  cols.hpMax[row] = opts.hp;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

interface EncounterTickFrame {
  tick: number;
  events: SimEventWire[];
  directives: FaunaDirective[];
  correction: FaunaSparseCorrection | null;
  snapshotBytes: Uint8Array;
}

function runAuthoritativeSpitterEncounter(): {
  initialSnapshot: Uint8Array;
  targetUnitId: number;
  hiveId: number;
  frames: EncounterTickFrame[];
} {
  const { host, state, data } = createSpitterEncounterHost('spitter-sync-encounter');
  const hiveId = spawnHiveEntity(
    state,
    { species: 'greenSpitter', q: 0, r: 0, initialResidents: 3 },
    0,
    data,
  );
  const targetUnitId = spawnTargetUnit(state, {
    kind: ENTITY_KIND.harvester,
    owner: 0,
    q: 4,
    r: 0,
    hp: 36,
  });

  applyDamage(state, hiveId, 10, { attackerId: targetUnitId, attackerOwner: 0, tick: 0, data });
  const { decisionIndex: dec1 } = nextFaunaGameplayRng(state, hiveId, 0);
  emitFaunaDirective(state, {
    effectiveTick: 0,
    hiveId,
    decisionIndex: dec1,
    kind: 'mode',
    payload: { mode: 'aggressive', targetColony: 0, reason: 'provoked' },
  });
  const memberIds = [...(getHiveRecord(state, hiveId)?.residentIds ?? [])];
  const { decisionIndex: dec2 } = nextFaunaGameplayRng(state, hiveId, 0);
  emitFaunaDirective(state, {
    effectiveTick: 0,
    hiveId,
    decisionIndex: dec2,
    kind: 'cohortDispatch',
    payload: {
      cohortId: `cohort:${hiveId}:acid-sync`,
      species: 'greenSpitter',
      memberIds,
      targetColony: 0,
      targetEntityId: targetUnitId,
      objectiveQ: 4,
      objectiveR: 0,
    },
  });

  const initialSnapshot = encodeSnapshot(state);
  const initialDirectives = drainFaunaDirectivesOutbox(state);
  const frames: EncounterTickFrame[] = [];
  const stepEvents: SimEventWire[] = [];
  host.onEvents((evs) => {
    for (const e of evs) {
      stepEvents.push({
        kind: e.kind,
        severity: e.severity,
        atTick: e.atTick,
        colonyIds: [...e.colonyIds],
        data: { ...e.data },
      });
    }
  });

  for (let step = 1; step <= 45; step++) {
    stepEvents.length = 0;
    host.step(1);
    const tick = host.tick;
    const drained = drainFaunaDirectivesOutbox(state);
    const directives = step === 1 ? [...initialDirectives, ...drained] : drained;
    const correction = buildFaunaSparseCorrection(state, tick);
    frames.push({
      tick,
      events: [...stepEvents],
      directives,
      correction,
      snapshotBytes: encodeSnapshot(state),
    });
  }

  return { initialSnapshot, targetUnitId, hiveId, frames };
}

describe('W07-17 · Two clients in a greenSpitter encounter agree on acid impacts, HP, and deaths', () => {
  it('converges on identical acid launches, acid impacts, per-tick HP, and entity deaths across two client replicas with duplicate deliveries', () => {
    const { initialSnapshot, targetUnitId, frames } = runAuthoritativeSpitterEncounter();
    const syncA = new CombatSyncController(new THREE.Scene());
    const syncB = new CombatSyncController(new THREE.Scene());
    const replicaA = decodeSnapshot(initialSnapshot);
    const replicaB = decodeSnapshot(initialSnapshot);
    syncA.syncPlanetState(replicaA);
    syncB.syncPlanetState(replicaB);

    const hpTimelineA: number[] = [];
    const hpTimelineB: number[] = [];

    for (const frame of frames) {
      const authoritativeTickState = decodeSnapshot(frame.snapshotBytes);
      syncA.applyFaunaDirectives(replicaA, frame.directives);
      if (frame.correction) syncA.applyFaunaSparseCorrection(replicaA, frame.correction);
      syncA.ingestCombatEvents(frame.events);
      syncA.syncPlanetState(authoritativeTickState);
      syncA.update(0.2);

      // Client B receives predicted + server events + duplicate directive & sparse correction deliveries
      syncB.applyFaunaDirectives(replicaB, frame.directives);
      syncB.applyFaunaDirectives(replicaB, frame.directives);
      if (frame.correction) {
        syncB.applyFaunaSparseCorrection(replicaB, frame.correction);
        syncB.applyFaunaSparseCorrection(replicaB, frame.correction);
      }
      syncB.ingestCombatEvents(frame.events);
      syncB.ingestCombatEvents(frame.events);
      syncB.ingestCombatEvents(frame.events);
      syncB.syncPlanetState(authoritativeTickState);
      syncB.update(0.2);

      hpTimelineA.push(syncA.hpByEntityId.get(targetUnitId) ?? 0);
      hpTimelineB.push(syncB.hpByEntityId.get(targetUnitId) ?? 0);
    }

    const acidFiredA = syncA.firedHistory.filter((f) => f.weaponKind === 'acid');
    const acidFiredB = syncB.firedHistory.filter((f) => f.weaponKind === 'acid');
    expect(acidFiredA.length).toBeGreaterThan(0);
    expect(acidFiredB).toEqual(acidFiredA);

    const acidImpactsA = syncA.impactHistory.filter((imp) => imp.weaponKind === 'acid');
    const acidImpactsB = syncB.impactHistory.filter((imp) => imp.weaponKind === 'acid');
    expect(acidImpactsA.length).toBeGreaterThan(0);
    expect(acidImpactsA.some((imp) => imp.hit && imp.hitEntityIds.includes(targetUnitId))).toBe(true);
    expect(acidImpactsB).toEqual(acidImpactsA);

    expect(hpTimelineA[0]).toBeGreaterThan(0);
    expect(hpTimelineA[hpTimelineA.length - 1]).toBe(0);
    expect(hpTimelineB).toEqual(hpTimelineA);
    expect(syncA.confirmedDeaths.has(targetUnitId)).toBe(true);
    expect([...syncB.confirmedDeaths].sort((a, b) => a - b)).toEqual([...syncA.confirmedDeaths].sort((a, b) => a - b));

    expect(syncB.vfxFiredSpawnCount).toBe(syncA.vfxFiredSpawnCount);
    expect(syncB.vfxImpactSpawnCount).toBe(syncA.vfxImpactSpawnCount);
    expect(syncB.vfxSpawnCount).toBe(syncA.vfxSpawnCount);
    expect(syncA.duplicateFiredIgnored).toBe(0);
    expect(syncA.duplicateImpactIgnored).toBe(0);
    expect(syncB.duplicateFiredIgnored).toBe(syncA.vfxFiredSpawnCount * 2);
    expect(syncB.duplicateImpactIgnored).toBe(syncA.vfxImpactSpawnCount * 2);
    expect(syncB.fauna.duplicateDirectivesIgnored).toBeGreaterThan(0);
    expect(syncB.fauna.duplicateCorrectionsIgnored).toBeGreaterThan(0);

    expect(getFaunaDirectivesState(replicaB).lastSeq).toBe(getFaunaDirectivesState(replicaA).lastSeq);
    expect(getAllResidentBugs(replicaB)).toEqual(getAllResidentBugs(replicaA));

    syncA.dispose();
    syncB.dispose();
  });
});

describe('W07-17 · Deduplicating view.blobs.projectileImpacts against store/host events', () => {
  it('deduplicates in-flight view.blobs.projectileImpacts against projectileFired events and wires store/host events into EntityMeshes', () => {
    const { host, state, data } = createSpitterEncounterHost('blob-dedup-seed');
    const hiveId = spawnHiveEntity(state, { species: 'greenSpitter', q: 0, r: 0, initialResidents: 1 }, 0, data);
    const bugId = getHiveRecord(state, hiveId)!.residentIds[0]!;
    const targetId = spawnTargetUnit(state, { kind: ENTITY_KIND.harvester, owner: 0, q: 3, r: 0, hp: 160 });
    applyDamage(state, hiveId, 10, { attackerId: targetId, attackerOwner: 0, tick: 0, data });

    const emitted: SimEventWire[] = [];
    host.onEvents((evs) => {
      for (const e of evs) {
        emitted.push({ kind: e.kind, severity: e.severity, atTick: e.atTick, colonyIds: [...e.colonyIds], data: { ...e.data } });
      }
    });

    for (let i = 0; i < 6 && !emitted.some((e) => e.kind === 'projectileFired'); i++) host.step(1);
    const firedEv = emitted.find((e) => e.kind === 'projectileFired')!;
    expect(firedEv).toBeDefined();
    expect(canonicalProjectileFiredKey(firedEv)).toContain(`fired:${bugId}:`);
    expect(canonicalProjectileFiredKey(firedEv)).toContain(':acid:');

    const scene = new THREE.Scene();
    const dummyMeshFactory = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const entities = new EntityMeshes(scene, dummyMeshFactory, false);

    const { view: wireView } = packView(host.view(), true);
    const clientView = unpackView(wireView);
    entities.syncView(clientView, null);
    expect(entities.combatSync.vfxFiredSpawnCount).toBe(1);

    const serverListeners: Array<(e: readonly SimEventWire[]) => void> = [];
    const renderListeners: Array<(e: readonly SimEventWire[]) => void> = [];
    const unbind = bindStoreCombatEvents(
      {
        onServerEvents: (fn) => { serverListeners.push(fn); return () => {}; },
        onRenderEvents: (fn) => { renderListeners.push(fn); return () => {}; },
      },
      entities.combatSync,
      () => null,
    );
    renderListeners.forEach((fn) => fn([firedEv]));
    serverListeners.forEach((fn) => fn([firedEv]));
    ingestHostMessageCombatEvents({ v: 1, t: 'event', tick: firedEv.atTick, d: firedEv }, entities.combatSync, null);
    expect(entities.combatSync.vfxFiredSpawnCount).toBe(1);
    expect(entities.combatSync.duplicateFiredIgnored).toBe(3);

    const impactEv: SimEventWire = {
      kind: 'projectileImpact', severity: 'info', atTick: firedEv.atTick + 2, colonyIds: [],
      data: { attackerId: bugId, targetId, weaponId: 'spitterAcid', weaponType: 'bullet', aimX: 3, aimY: 0, q: 3, r: 0, hit: true, damage: 12 },
    };
    expect(canonicalProjectileImpactKey(impactEv)).toBe(`impact:${bugId}:${firedEv.atTick + 2}:acid:3,0`);
    serverListeners.forEach((fn) => fn([impactEv, impactEv]));
    expect(entities.combatSync.vfxImpactSpawnCount).toBe(1);
    expect(entities.combatSync.duplicateImpactIgnored).toBe(1);

    unbind();
    entities.dispose();
  });
});

describe('W07-17 · W07 entityKinds mappings, footprints, and tracked unit predicates', () => {
  it('maps all W07 ENTITY_KIND codes in archetypeForKind, isConstructibleBuilding, is2x2BuildingKind, is3x3FootprintKind, and isTrackedWalkingUnitKind', () => {
    expect(archetypeForKind(ENTITY_KIND.roboticsFactory)).toBe('building.roboticsFactory');
    expect(archetypeForKind(ENTITY_KIND.droneControlArray)).toBe('building.droneArray');
    expect(archetypeForKind(ENTITY_KIND.autocannon)).toBe('building.turret');
    expect(archetypeForKind(ENTITY_KIND.laserTower)).toBe('building.laserTower');
    expect(archetypeForKind(ENTITY_KIND.recon)).toBe('robot.recon');
    expect(archetypeForKind(ENTITY_KIND.demoTank)).toBe('robot.combat');
    expect(archetypeForKind(ENTITY_KIND.demoArtillery)).toBe('robot.combat');
    expect(archetypeForKind(ENTITY_KIND.blackAnt)).toBe('fauna.blackAnt');
    expect(archetypeForKind(ENTITY_KIND.blueBeetle)).toBe('fauna.blueBeetle');
    expect(archetypeForKind(ENTITY_KIND.greenSpitter)).toBe('fauna.greenSpitter');
    expect(archetypeForKind(ENTITY_KIND.hiveBlackAnt)).toBe('fauna.hive.blackAnt');
    expect(archetypeForKind(ENTITY_KIND.hiveBlueBeetle)).toBe('fauna.hive.blueBeetle');
    expect(archetypeForKind(ENTITY_KIND.hiveGreenSpitter)).toBe('fauna.hive.greenSpitter');

    for (const k of [ENTITY_KIND.roboticsFactory, ENTITY_KIND.droneControlArray, ENTITY_KIND.autocannon, ENTITY_KIND.laserTower]) {
      expect(isConstructibleBuilding(k)).toBe(true);
      expect(computeWorkTarget(k, ENTITY_STATE.active, false)).toBe(1);
    }
    expect(isConstructibleBuilding(ENTITY_KIND.hiveBlackAnt)).toBe(false);
    expect(isConstructibleBuilding(ENTITY_KIND.greenSpitter)).toBe(false);

    for (const k of [ENTITY_KIND.droneControlArray, ENTITY_KIND.autocannon, ENTITY_KIND.laserTower]) {
      expect(is2x2BuildingKind(k)).toBe(false);
    }

    for (const k of [ENTITY_KIND.commandHub, ENTITY_KIND.roboticsFactory, ENTITY_KIND.hiveBlackAnt, ENTITY_KIND.hiveBlueBeetle, ENTITY_KIND.hiveGreenSpitter]) {
      expect(is3x3FootprintKind(k)).toBe(true);
      expect(computeWorkTarget(k, ENTITY_STATE.active, false)).toBe(1);
    }

    const mockTerrain = { heightAt: (wx: number, wz: number) => (wx > 0 || wz > 0 ? 4.5 : 1.0) } as unknown as HexTerrain;
    expect(entityGroundY(mockTerrain, ENTITY_KIND.roboticsFactory, 0, 0, 0, 0)).toBe(4.5);
    expect(entityGroundY(mockTerrain, ENTITY_KIND.hiveGreenSpitter, 0, 0, 0, 0)).toBe(4.5);

    for (const k of [
      ENTITY_KIND.hq, ENTITY_KIND.harvester, ENTITY_KIND.builder,
      ENTITY_KIND.recon, ENTITY_KIND.demoTank, ENTITY_KIND.demoArtillery,
      ENTITY_KIND.blackAnt, ENTITY_KIND.blueBeetle, ENTITY_KIND.greenSpitter,
    ]) {
      expect(isTrackedWalkingUnitKind(k)).toBe(true);
    }
    expect(isTrackedWalkingUnitKind(ENTITY_KIND.autocannon)).toBe(false);
    expect(isTrackedWalkingUnitKind(ENTITY_KIND.hiveBlackAnt)).toBe(false);
  });
});
