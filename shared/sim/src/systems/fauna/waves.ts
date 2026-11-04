import type { CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { findHexPath, pathBlockersFor } from '../../grid/path';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { seedStream } from '../../kernel/rng';
import type { PlanetState } from '../../kernel/state';
import { emitRaidStarted } from '../combat/events';
import {
  FAUNA_SPECIES_THREAT_COSTS,
  getFaunaSpeciesThreatCost,
  MAX_RAID_SIZE,
  registerFaunaThreatSpecies,
  threatOf,
} from '../progression/threat';
import { countColonyEntities } from '../progression/triggers';
import { issueUnitCommand } from '../units/registry';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import {
  defaultFaunaData,
  resolveSpeciesConfig,
  type FaunaCohortRecord,
  type FaunaHivesBlob,
  type FaunaSpeciesId,
  type HiveRecord,
} from './types';

export {
  FAUNA_SPECIES_THREAT_COSTS,
  getFaunaSpeciesThreatCost,
  registerFaunaThreatSpecies,
};

export interface ResolvedFaunaWaveConfig {
  maxWavesPerEpisode: number;
  waveCooldownTicks: number;
  waveRetreatTimeoutTicks: number;
  raidIntervalTicks: number;
  graceAfterS3Ticks: number;
  baseChance: number;
  perThermalChance: number;
}

export interface DispatchHiveWaveOptions {
  budget?: number;
  tick?: number;
  data?: CompiledDataLike;
  ignoreCooldown?: boolean;
}

export interface SpawnHiveRaidWaveOptions {
  colonyIndex: number;
  hiveId?: number;
  species?: FaunaSpeciesId;
  budget?: number;
  tick?: number;
  data?: CompiledDataLike;
}

export function resolveWaveConfig(data?: CompiledDataLike): ResolvedFaunaWaveConfig {
  const src = data ?? defaultFaunaData();
  const tbl = src.tables?.fauna as Readonly<Record<string, CompiledRow | undefined>> | undefined;
  const hiveCfg = tbl?.hiveConfig;
  const raidCfg = tbl?.raidConfig;

  const maxWaves = Number(hiveCfg?.maxWavesPerEpisode ?? 3);
  const cooldownS = Number(hiveCfg?.waveCooldownS ?? 60);
  const timeoutS = Number(raidCfg?.waveRetreatTimeoutS ?? 300);
  const intervalS = Number(raidCfg?.raidIntervalS ?? 600);
  const graceS = Number(raidCfg?.graceAfterS3S ?? 300);
  const baseChance = Number(raidCfg?.baseChance ?? 0.1);
  const perThermalChance = Number(raidCfg?.perThermalChance ?? 0.05);

  return {
    maxWavesPerEpisode: Number.isFinite(maxWaves) && maxWaves >= 1 ? Math.round(maxWaves) : 3,
    waveCooldownTicks: Math.max(1, Math.round(cooldownS * TICKS_PER_SECOND)),
    waveRetreatTimeoutTicks: Math.max(1, Math.round(timeoutS * TICKS_PER_SECOND)),
    raidIntervalTicks: Math.max(1, Math.round(intervalS * TICKS_PER_SECOND)),
    graceAfterS3Ticks: Math.max(1, Math.round(graceS * TICKS_PER_SECOND)),
    baseChance: Number.isFinite(baseChance) ? baseChance : 0.1,
    perThermalChance: Number.isFinite(perThermalChance) ? perThermalChance : 0.05,
  };
}

function createFallbackCtx(
  state: PlanetState,
  tick: number,
  data?: CompiledDataLike,
): StepContext {
  const resolvedData = data ?? defaultFaunaData();
  return {
    dt: 1,
    tick,
    flags: new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']),
    data: resolvedData,
    rng: (s) => seedStream(String(state.meta.seed), `${s}:${tick}`),
    newEntityId: () => state.meta.nextEntityId++,
    emit: () => {},
    events: [],
    record: () => {},
    postings: [],
  };
}

export function computeWaveThreatBudget(
  state: PlanetState,
  colonyIndex: number,
): number {
  const summary = threatOf(state, colonyIndex);
  const counts = countColonyEntities(state, colonyIndex);
  const col = state.colonies[colonyIndex];
  const isBareSyntheticColony =
    counts.completedBuildings === 0 &&
    col?.threatStage === undefined &&
    col?.stage === undefined;
  const effectiveThreatStage = isBareSyntheticColony ? 3 : summary.threatStage;
  return Math.min(MAX_RAID_SIZE, 2 + effectiveThreatStage + summary.thermalGenerators);
}

export function hasAnyAliveColonyEntity(state: PlanetState, colonyIndex: number): boolean {
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    return true;
  }
  return false;
}

export function isTargetReachableFrom(
  state: PlanetState,
  fromQ: number,
  fromR: number,
  targetQ: number,
  targetR: number,
  bandMax: number,
  data?: CompiledDataLike,
): boolean {
  if (hexDistance(fromQ, fromR, targetQ, targetR) <= bandMax) return true;
  const fromIdx = hexIndex(state.grid.radius).indexOf(fromQ, fromR);
  const blockers = pathBlockersFor(state, 'harvester', fromIdx, data);
  const res = findHexPath(
    state,
    { q: fromQ, r: fromR },
    { q: targetQ, r: targetR },
    {
      radius: state.grid.radius,
      maxExpansions: 2500,
      data,
      band: { minDist: 0, maxDist: Math.max(1, bandMax) },
      ...(blockers ? { blocked: blockers.blocked, goalBlocked: blockers.goalBlocked } : {}),
    },
  );
  return res.ok;
}

export interface ColonyTargetMatch {
  id: number;
  row: number;
  q: number;
  r: number;
  bandMax: number;
  reachable: boolean;
}

export function findNearestColonyTarget(
  state: PlanetState,
  fromQ: number,
  fromR: number,
  colonyIndex: number,
  bandMax = 1,
  data?: CompiledDataLike,
): ColonyTargetMatch | null {
  const cols = state.entities.cols;
  const candidates: Array<{ id: number; row: number; q: number; r: number; dist: number; bandMax: number }> = [];
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const q = cols.q[r]!;
    const rv = cols.r[r]!;
    const fpPad = Math.floor(Math.max(1, cols.footprintW[r] || 1) / 2);
    candidates.push({
      id: cols.id[r]!,
      row: r,
      q,
      r: rv,
      dist: hexDistance(fromQ, fromR, q, rv),
      bandMax: bandMax + fpPad,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.dist !== b.dist ? a.dist - b.dist : a.id - b.id));

  for (const c of candidates) {
    if (isTargetReachableFrom(state, fromQ, fromR, c.q, c.r, c.bandMax, data)) {
      return { id: c.id, row: c.row, q: c.q, r: c.r, bandMax: c.bandMax, reachable: true };
    }
  }
  const first = candidates[0]!;
  return { id: first.id, row: first.row, q: first.q, r: first.r, bandMax: first.bandMax, reachable: false };
}

function collectAvailableResidentIds(
  state: PlanetState,
  fauna: FaunaHivesBlob,
  hive: HiveRecord,
  maxCount: number,
): number[] {
  if (maxCount <= 0) return [];
  const cols = state.entities.cols;
  const out: number[] = [];
  for (const bugId of hive.residentIds) {
    const bRow = rowOf(state.entities, bugId);
    if (bRow < 0 || cols.hp[bRow]! <= 0) continue;
    const bug = fauna.bugsById[bugId];
    if (!bug || bug.cohortId !== null) continue;
    out.push(bugId);
    if (out.length >= maxCount) break;
  }
  return out;
}

export function flushPendingFaunaEvents(state: PlanetState, ctx: StepContext): void {
  const fauna = getFaunaHivesState(state);
  if (!fauna.pendingEvents || fauna.pendingEvents.length === 0) return;
  const events = [...fauna.pendingEvents];
  fauna.pendingEvents = [];
  saveFaunaHivesState(state, fauna, ctx.tick);
  for (const ev of events) {
    ctx.emit({
      kind: ev.kind,
      colonyIds: [ev.colonyIndex],
      data: ev.data,
    });
  }
}

function activateCohortAndEmitRaid(
  state: PlanetState,
  fauna: FaunaHivesBlob,
  hive: HiveRecord,
  cohort: FaunaCohortRecord,
  target: ColonyTargetMatch,
  tick: number,
  data: CompiledDataLike,
  ctx?: StepContext,
): void {
  const { cohortId, colonyIndex, memberIds } = cohort;
  const agg = hive.aggressionByColony[colonyIndex]!;
  fauna.cohortsById[cohortId] = cohort;
  agg.wavesSent += 1;
  agg.lastWaveTick = tick;
  agg.activeCohortId = cohortId;
  if (!hive.lastWaveTickByColony) hive.lastWaveTickByColony = {};
  hive.lastWaveTickByColony[colonyIndex] = tick;

  for (const bugId of memberIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug) continue;
    bug.cohortId = cohortId;
    if (!bug.aggressiveColonies.includes(colonyIndex)) {
      bug.aggressiveColonies = [...bug.aggressiveColonies, colonyIndex].sort((a, b) => a - b);
    }
    bug.mode = 'aggressive';
    bug.targetColony = colonyIndex;
  }

  const threatStage = threatOf(state, colonyIndex).threatStage;
  const raidPayload = {
    colonyIndex,
    hiveId: hive.hiveId,
    species: hive.species,
    waveNumber: agg.wavesSent,
    count: memberIds.length,
    threatStage,
    q: hive.q,
    r: hive.r,
    raidId: cohortId,
  };
  if (!ctx) {
    fauna.pendingEvents.push({
      kind: 'raidStarted',
      colonyIndex,
      data: { ...raidPayload },
    });
  }
  saveFaunaHivesState(state, fauna, tick);
  emitRaidStarted(state, raidPayload, ctx);

  const stepCtx = ctx ?? createFallbackCtx(state, tick, data);
  for (const bugId of memberIds) {
    const bRow = rowOf(state.entities, bugId);
    if (bRow < 0) continue;
    issueUnitCommand(
      state,
      bRow,
      { kind: 'move', source: 'auto', q: target.q, r: target.r, minDist: 0, maxDist: target.bandMax },
      stepCtx,
    );
  }
}

/**
 * Dispatches a single bounded wave cohort of living, non-dispatched residents from `hiveId`
 * against `colonyIndex`. Enforces `maxWavesPerEpisode = 3`, `waveCooldownTicks = 300` (`60 s`),
 * `<= 1` active cohort per `(hiveId, colonyIndex)`, and species threat-point cost budgets.
 * Never spawns free units.
 */
export function dispatchHiveWave(
  state: PlanetState,
  hiveId: number,
  colonyIndex: number,
  opts?: DispatchHiveWaveOptions,
  ctx?: StepContext,
): FaunaCohortRecord | null {
  const tick = opts?.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts?.data ?? ctx?.data ?? defaultFaunaData();
  const waveCfg = resolveWaveConfig(data);
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[hiveId];
  if (!hive || hive.destroyed) return null;

  const agg = hive.aggressionByColony[colonyIndex];
  if (!agg) return null;
  if (agg.activeCohortId !== null && fauna.cohortsById[agg.activeCohortId]) return null;
  if (agg.wavesSent >= agg.maxWaves) return null;

  const lastWave = Math.max(
    agg.lastWaveTick,
    hive.lastWaveTickByColony?.[colonyIndex] ?? -999999,
  );
  if (!opts?.ignoreCooldown && tick - lastWave < waveCfg.waveCooldownTicks) {
    return null;
  }

  const speciesCfg = resolveSpeciesConfig(hive.species, data);
  const speciesCost = Math.max(1, getFaunaSpeciesThreatCost(hive.species) || speciesCfg.threatCost);
  const budget =
    typeof opts?.budget === 'number'
      ? Math.max(0, Math.min(MAX_RAID_SIZE, Math.floor(opts.budget)))
      : computeWaveThreatBudget(state, colonyIndex);
  const maxMembers = Math.floor(budget / speciesCost);
  const memberIds = collectAvailableResidentIds(state, fauna, hive, maxMembers);
  if (memberIds.length === 0) return null;

  const bandMax = speciesCfg.range >= 2 ? Math.floor(speciesCfg.range) - 1 : 1;
  const target = findNearestColonyTarget(
    state,
    hive.entranceQ,
    hive.entranceR,
    colonyIndex,
    bandMax,
    data,
  );
  if (!target) return null;

  const cohortId = `cohort_${fauna.nextCohortSeq++}`;
  const cohort: FaunaCohortRecord = {
    cohortId,
    hiveId: hive.hiveId,
    species: hive.species,
    colonyIndex,
    memberIds,
    dispatchedAtTick: tick,
    targetEntityId: target.id,
    timeoutTicks: waveCfg.waveRetreatTimeoutTicks,
  };

  activateCohortAndEmitRaid(state, fauna, hive, cohort, target, tick, data, ctx);
  return cohort;
}

function findColonyAnchor(
  state: PlanetState,
  colonyIndex: number,
): { q: number; r: number } | null {
  const cols = state.entities.cols;
  let fallback: { q: number; r: number } | null = null;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const kind = cols.kind[r]!;
    if (kind === ENTITY_KIND.commandHub || kind === ENTITY_KIND.hq) {
      return { q: cols.q[r]!, r: cols.r[r]! };
    }
    if (!fallback) fallback = { q: cols.q[r]!, r: cols.r[r]! };
  }
  return fallback;
}

export function selectCandidateHiveForRaid(
  state: PlanetState,
  colonyIndex: number,
  opts?: { hiveId?: number; species?: FaunaSpeciesId; requireReachable?: boolean; data?: CompiledDataLike },
): HiveRecord | null {
  const fauna = getFaunaHivesState(state);
  if (typeof opts?.hiveId === 'number') {
    const h = fauna.hivesById[opts.hiveId];
    return h && !h.destroyed ? h : null;
  }
  const anchor = findColonyAnchor(state, colonyIndex);
  if (!anchor) return null;

  const hives = Object.values(fauna.hivesById)
    .filter((h) => !h.destroyed && (!opts?.species || h.species === opts.species))
    .sort((a, b) => {
      const da = hexDistance(a.q, a.r, anchor.q, anchor.r);
      const db = hexDistance(b.q, b.r, anchor.q, anchor.r);
      return da !== db ? da - db : a.hiveId - b.hiveId;
    });

  for (const h of hives) {
    if (opts?.requireReachable) {
      const cfg = resolveSpeciesConfig(h.species, opts.data);
      const bandMax = cfg.range >= 2 ? Math.floor(cfg.range) - 1 : 1;
      const targetMatch = findNearestColonyTarget(
        state,
        h.entranceQ,
        h.entranceR,
        colonyIndex,
        bandMax,
        opts.data,
      );
      if (!targetMatch || !targetMatch.reachable) {
        continue;
      }
    }
    return h;
  }
  return null;
}

/**
 * Unified helper for dev commands (`spawnRaid`), tests, and scheduled rolls:
 * selects a live hive (by `hiveId`, `species`, or closest to `colonyIndex`), ensures an
 * aggression episode is active, and dispatches a bounded wave of living residents.
 */
export function spawnHiveRaidWave(state: PlanetState, opts: SpawnHiveRaidWaveOptions, ctx?: StepContext): FaunaCohortRecord | null;
export function spawnHiveRaidWave(state: PlanetState, hiveId: number, colonyIndex?: number, tick?: number, ctx?: StepContext): number;
export function spawnHiveRaidWave(
  state: PlanetState,
  optsOrHiveId: SpawnHiveRaidWaveOptions | number,
  colonyIndexOrCtx?: number | StepContext,
  tickArg?: number,
  ctxArg?: StepContext,
): FaunaCohortRecord | null | number {
  const isPositional = typeof optsOrHiveId === 'number';
  const ctx = isPositional ? ctxArg : (colonyIndexOrCtx as StepContext | undefined);
  const opts: SpawnHiveRaidWaveOptions = isPositional
    ? { hiveId: optsOrHiveId, colonyIndex: typeof colonyIndexOrCtx === 'number' ? colonyIndexOrCtx : 0, tick: tickArg }
    : optsOrHiveId;
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data ?? defaultFaunaData();
  const hive = selectCandidateHiveForRaid(state, opts.colonyIndex, { hiveId: opts.hiveId, species: opts.species, data });
  if (!hive) return isPositional ? 0 : null;

  const fauna = getFaunaHivesState(state);
  const liveHive = fauna.hivesById[hive.hiveId];
  if (!liveHive || liveHive.destroyed) return isPositional ? 0 : null;

  const waveCfg = resolveWaveConfig(data);
  if (!liveHive.aggressionByColony[opts.colonyIndex]) {
    const prevTick = liveHive.lastWaveTickByColony?.[opts.colonyIndex] ?? -999999;
    liveHive.aggressionByColony[opts.colonyIndex] = {
      colonyIndex: opts.colonyIndex,
      triggeredAtTick: tick,
      wavesSent: 0,
      maxWaves: waveCfg.maxWavesPerEpisode,
      lastWaveTick: prevTick,
      activeCohortId: null,
    };
    liveHive.mode = 'aggressive';
    saveFaunaHivesState(state, fauna, tick);
  }

  const cohort = dispatchHiveWave(state, hive.hiveId, opts.colonyIndex, { budget: opts.budget, tick, data }, ctx);
  return isPositional ? (cohort?.memberIds.length ?? 0) : cohort;
}

export {
  stepActiveCohorts,
  stepProvokedHiveWaveDispatches,
  stepScheduledHiveWaves,
} from './waveCohorts';

