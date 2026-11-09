import { parseWaves, type SimEventWire } from '@terra/contracts';
import {
  buildFaunaSparseCorrection,
  createRegistryPipeline,
  createState,
  decodeSnapshot,
  drainFaunaDirectivesOutbox,
  encodeSnapshot,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  PREP,
  SIM_VERSION,
  SimHost,
  spawnHiveEntity,
  spawnHqUnit,
  startBuildingConstruction,
  TERRAIN,
  type CompiledDataLike,
  type PlanetState,
} from '@terra/sim';
import type { CombatSyncController } from '../../../frontend/game/app/online/combatSync';
import { LocalHost } from '../../../frontend/game/store/local/LocalHost';
import { builtPlanetSource } from '../../../frontend/game/store/local/planetSource';
import type { ReplicaCore, WelcomeInput } from '../../../frontend/game/store/replica/ReplicaCore';

export function spawnColonyUnit(
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

export function buildW07ParitySeedState(seed: string, radius = 24): {
  initialBytes: Uint8Array;
  flags: ReturnType<typeof parseWaves>;
  data: CompiledDataLike;
  reconId: number;
  baitUnitId: number;
  spitterHiveId: number;
  antHiveId: number;
} {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const data = pipeline.config.data;
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  const col = ensureColonyRecord(state, 0, 0);
  col.status = 'active';
  col.stage = 3;
  col.threatStage = 3;
  spawnHqUnit(state, { owner: 0, q: -3, r: 0 });
  const hubRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: -6,
    r: 0,
    instant: true,
    costOverride: {},
    data,
  });
  if (!hubRes.ok) throw new Error(`commandHub failed: ${hubRes.code}`);

  const rfRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'roboticsFactory',
    q: -6,
    r: 4,
    instant: true,
    costOverride: {},
    data,
  });
  if (!rfRes.ok) throw new Error(`roboticsFactory failed: ${rfRes.code}`);

  const reconId = spawnColonyUnit(state, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0, hp: 240 });
  const baitUnitId = spawnColonyUnit(state, { kind: ENTITY_KIND.worker, owner: 0, q: 3, r: 0, hp: 24 });
  const spitterHiveId = spawnHiveEntity(state, { species: 'greenSpitter', q: 5, r: 0, initialResidents: 3 }, 0, data);
  const antHiveId = spawnHiveEntity(state, { species: 'blackAnt', q: -12, r: 0, initialResidents: 4 }, 0, data);

  return { initialBytes: encodeSnapshot(state), flags, data, reconId, baitUnitId, spitterHiveId, antHiveId };
}

export function createDualHostsFromSnapshot(name: string, flagsList: readonly string[], snapshotBytes: Uint8Array): {
  serverHost: SimHost;
  localHost: LocalHost;
} {
  const flags = parseWaves(flagsList.join(','));
  const serverHost = new SimHost(createRegistryPipeline({ flags }));
  serverHost.load(decodeSnapshot(snapshotBytes));
  const localHost = new LocalHost({
    flags: flagsList,
    source: builtPlanetSource(name, flagsList, () => decodeSnapshot(snapshotBytes)),
  });
  return { serverHost, localHost };
}

export function makeWelcome(host: SimHost, flags: readonly string[]): WelcomeInput {
  return {
    state: host.snapshot({ forClient: true }),
    tick: host.tick,
    flags,
    dataHash: host.pipeline.config.data.hash,
    simVersion: SIM_VERSION,
  };
}

export function attachEventCollector(host: SimHost): SimEventWire[] {
  const events: SimEventWire[] = [];
  host.onEvents((evs) => {
    for (const e of evs) {
      events.push({
        kind: e.kind,
        severity: e.severity,
        atTick: e.atTick,
        colonyIds: [...e.colonyIds],
        data: { ...e.data },
      });
    }
  });
  return events;
}

export function stepServerLocalAndReplicas(opts: {
  serverHost: SimHost;
  localHost?: LocalHost;
  serverEvents: SimEventWire[];
  replicas: ReadonlyArray<{ replica: ReplicaCore; sync?: CombatSyncController }>;
  data: CompiledDataLike;
}): void {
  const { serverHost, localHost, serverEvents, replicas, data } = opts;
  const fromTick = serverHost.tick;
  serverEvents.length = 0;
  serverHost.step(1);
  localHost?.step(1);

  const diff = serverHost.diffSince(fromTick, { forClient: true });
  const directives = drainFaunaDirectivesOutbox(serverHost.state);
  if (localHost) drainFaunaDirectivesOutbox(localHost.state);
  const correction = buildFaunaSparseCorrection(serverHost.state, serverHost.tick);
  if (localHost) buildFaunaSparseCorrection(localHost.state, localHost.tick);

  for (const { replica, sync } of replicas) {
    const res = replica.delta({ fromTick, toTick: serverHost.tick, diff });
    if (!res.ok) throw new Error(`replica delta failed: ${res.reason} ${res.detail}`);
    if (sync) {
      sync.applyFaunaDirectives(replica.state, directives, { data });
      if (correction) sync.applyFaunaSparseCorrection(replica.state, correction, data);
      sync.ingestCombatEvents(serverEvents);
      sync.syncPlanetState(replica.state);
    }
  }
}

export function collectEntitySummary(state: PlanetState) {
  const cols = state.entities.cols;
  const rows: Array<{
    id: number;
    kind: number;
    owner: number;
    q: number;
    r: number;
    x: number;
    y: number;
    hp: number;
    targetQ: number;
    targetR: number;
  }> = [];
  for (let i = 0; i < state.entities.count; i++) {
    rows.push({
      id: cols.id[i]!,
      kind: cols.kind[i]!,
      owner: cols.owner[i]!,
      q: cols.q[i]!,
      r: cols.r[i]!,
      x: Math.round(cols.x[i]! * 1000) / 1000,
      y: Math.round(cols.y[i]! * 1000) / 1000,
      hp: Math.round(cols.hp[i]! * 100) / 100,
      targetQ: cols.targetQ[i]!,
      targetR: cols.targetR[i]!,
    });
  }
  return rows.sort((a, b) => a.id - b.id);
}
