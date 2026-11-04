import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { nextFloat, nextInt, nextU32, seedStream } from '../../kernel/rng';
import { setBlob, type PlanetState } from '../../kernel/state';
import { getUnitCommand } from '../../units/book';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import type { FaunaBehaviorMode, FaunaSpeciesId } from './types';

export const FAUNA_DIRECTIVE_VERSION = 1;
export const FAUNA_DIRECTIVES_BLOB = 'faunaDirectives';
export const FAUNA_CORRECTION_INTERVAL_TICKS = 25;
export const MAX_DIRECTIVE_LOG = 256;

export const FAUNA_DIFF_MASK = {
  x: 1 << 0,
  y: 1 << 1,
  rot: 1 << 2,
  q: 1 << 3,
  r: 1 << 4,
  targetQ: 1 << 5,
  targetR: 1 << 6,
  hp: 1 << 7,
  state: 1 << 8,
  spawn: 1 << 9,
  owner: 1 << 10,
  other: 1 << 11,
} as const;

export const FAUNA_RECONSTRUCTIBLE_MOTION_MASK =
  FAUNA_DIFF_MASK.x |
  FAUNA_DIFF_MASK.y |
  FAUNA_DIFF_MASK.rot |
  FAUNA_DIFF_MASK.q |
  FAUNA_DIFF_MASK.r;

export type FaunaDirectiveKind = 'spawn' | 'mode' | 'cohortDispatch' | 'cohortReturn' | 'targetChange';

export interface FaunaDirectivePayload {
  species?: FaunaSpeciesId;
  bugId?: number;
  q?: number;
  r?: number;
  mode?: FaunaBehaviorMode;
  targetColony?: number;
  cohortId?: string;
  memberIds?: number[];
  targetEntityId?: number;
  objectiveQ?: number;
  objectiveR?: number;
  reason?: string;
}

export interface FaunaDirective {
  version: number; // FAUNA_DIRECTIVE_VERSION (1)
  seq: number; // monotonically increasing sequence number per planet
  effectiveTick: number;
  hiveId: number;
  decisionIndex: number;
  kind: FaunaDirectiveKind;
  payload: FaunaDirectivePayload;
}

export interface FaunaSparseBugRecord {
  entityId: number;
  hiveId: number;
  hp: number;
  q: number;
  r: number;
  x: number;
  y: number;
  orderKind?: string;
  targetQ?: number;
  targetR?: number;
}

export interface FaunaSparseCorrection {
  tick: number;
  seq: number;
  bugs: FaunaSparseBugRecord[];
}

export interface FaunaCohortRecord {
  cohortId: string;
  hiveId: number;
  species: FaunaSpeciesId;
  memberIds: number[];
  targetColony: number;
  targetEntityId?: number;
  objectiveQ: number;
  objectiveR: number;
  dispatchedAtTick: number;
}

export interface FaunaBugWireSnapshot {
  hp: number;
  q: number;
  r: number;
  x: number;
  y: number;
  orderKind?: string;
  targetQ?: number;
  targetR?: number;
}

export interface FaunaDirectivesBlob {
  version: number;
  lastSeq: number;
  log: FaunaDirective[];
  appliedSeqs: number[];
  lastCorrectionTick: number;
  pendingOutbox: FaunaDirective[];
  cohortsById: Record<string, FaunaCohortRecord>;
  bufferedGapDirectives: FaunaDirective[];
  predictionPaused: boolean;
  lastSentBugSnapshots: Record<number, FaunaBugWireSnapshot>;
}

export type FaunaDirectivesSinceResult =
  | { ok: true; directives: FaunaDirective[] }
  | { ok: false; reason: 'log_gap' | 'version_mismatch'; earliestSeq: number };

export type FaunaCosmeticActivityKind = 'idle' | 'foraging' | 'resting' | 'grooming' | 'carrying' | 'tending';

export interface FaunaCosmeticSample {
  activity: FaunaCosmeticActivityKind;
  phase: number;
  headingOffset: number;
}

const COSMETIC_ACTIVITIES: readonly FaunaCosmeticActivityKind[] = [
  'idle',
  'foraging',
  'resting',
  'grooming',
  'carrying',
  'tending',
];

type DirectivePayloadExecutor = (
  state: PlanetState,
  directive: FaunaDirective,
  blob: FaunaDirectivesBlob,
  data?: CompiledDataLike,
) => void;

let registeredPayloadExecutor: DirectivePayloadExecutor | null = null;

export function registerDirectivePayloadExecutor(fn: DirectivePayloadExecutor): void {
  registeredPayloadExecutor = fn;
}

export function cloneDirectivePayload(payload: FaunaDirectivePayload): FaunaDirectivePayload {
  return {
    ...payload,
    ...(Array.isArray(payload.memberIds) ? { memberIds: [...payload.memberIds] } : {}),
  };
}

export function cloneFaunaDirective(d: FaunaDirective): FaunaDirective {
  return {
    version: d.version,
    seq: d.seq,
    effectiveTick: d.effectiveTick,
    hiveId: d.hiveId,
    decisionIndex: d.decisionIndex,
    kind: d.kind,
    payload: cloneDirectivePayload(d.payload),
  };
}

function cloneCohortsMap(raw: Record<string, FaunaCohortRecord> | undefined): Record<string, FaunaCohortRecord> {
  if (!raw) return {};
  const out: Record<string, FaunaCohortRecord> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v) out[k] = { ...v, memberIds: Array.isArray(v.memberIds) ? [...v.memberIds] : [] };
  }
  return out;
}

function cloneBugSnapshotsMap(
  raw: Record<number, FaunaBugWireSnapshot> | undefined,
): Record<number, FaunaBugWireSnapshot> {
  if (!raw) return {};
  const out: Record<number, FaunaBugWireSnapshot> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v) out[Number(k)] = { ...v };
  }
  return out;
}

/** Reads `state.blobs.faunaDirectives`, returning a fresh mutable copy with defaults filled. */
export function getFaunaDirectivesState(state: PlanetState): FaunaDirectivesBlob {
  const raw = state.blobs[FAUNA_DIRECTIVES_BLOB]?.value as Partial<FaunaDirectivesBlob> | undefined;
  return {
    version: typeof raw?.version === 'number' ? raw.version : FAUNA_DIRECTIVE_VERSION,
    lastSeq: typeof raw?.lastSeq === 'number' && raw.lastSeq >= 0 ? raw.lastSeq : 0,
    log: Array.isArray(raw?.log) ? raw.log.map(cloneFaunaDirective) : [],
    appliedSeqs: Array.isArray(raw?.appliedSeqs) ? [...raw.appliedSeqs] : [],
    lastCorrectionTick: typeof raw?.lastCorrectionTick === 'number' ? raw.lastCorrectionTick : -1,
    pendingOutbox: Array.isArray(raw?.pendingOutbox) ? raw.pendingOutbox.map(cloneFaunaDirective) : [],
    cohortsById: cloneCohortsMap(raw?.cohortsById),
    bufferedGapDirectives: Array.isArray(raw?.bufferedGapDirectives)
      ? raw.bufferedGapDirectives.map(cloneFaunaDirective)
      : [],
    predictionPaused: Boolean(raw?.predictionPaused),
    lastSentBugSnapshots: cloneBugSnapshotsMap(raw?.lastSentBugSnapshots),
  };
}

/** Persists `blob` into `state.blobs.faunaDirectives`. */
export function saveFaunaDirectivesState(
  state: PlanetState,
  blob: FaunaDirectivesBlob,
  tick = state.meta.tick,
): void {
  const trimmedLog =
    blob.log.length > MAX_DIRECTIVE_LOG ? blob.log.slice(blob.log.length - MAX_DIRECTIVE_LOG) : [...blob.log];
  const uniqueApplied = Array.from(new Set(blob.appliedSeqs)).sort((a, b) => a - b);
  const trimmedApplied =
    uniqueApplied.length > MAX_DIRECTIVE_LOG * 2
      ? uniqueApplied.slice(uniqueApplied.length - MAX_DIRECTIVE_LOG * 2)
      : uniqueApplied;

  const synced: FaunaDirectivesBlob = {
    version: blob.version,
    lastSeq: blob.lastSeq,
    log: trimmedLog.map(cloneFaunaDirective),
    appliedSeqs: trimmedApplied,
    lastCorrectionTick: blob.lastCorrectionTick,
    pendingOutbox: blob.pendingOutbox.map(cloneFaunaDirective),
    cohortsById: cloneCohortsMap(blob.cohortsById),
    bufferedGapDirectives: blob.bufferedGapDirectives.map(cloneFaunaDirective).sort((a, b) => a.seq - b.seq),
    predictionPaused: blob.predictionPaused,
    lastSentBugSnapshots: cloneBugSnapshotsMap(blob.lastSentBugSnapshots),
  };
  setBlob(state, FAUNA_DIRECTIVES_BLOB, synced, tick);
}

/** Emits an authoritative `FaunaDirective`, appends to bounded `blob.log`, and records in `appliedSeqs`. */
export function emitFaunaDirective(
  state: PlanetState,
  input: Omit<FaunaDirective, 'version' | 'seq'>,
  ctx?: StepContext,
): FaunaDirective {
  const blob = getFaunaDirectivesState(state);
  const seq = ++blob.lastSeq;
  const directive: FaunaDirective = {
    version: FAUNA_DIRECTIVE_VERSION,
    seq,
    effectiveTick: input.effectiveTick,
    hiveId: input.hiveId,
    decisionIndex: input.decisionIndex,
    kind: input.kind,
    payload: cloneDirectivePayload(input.payload),
  };

  if (registeredPayloadExecutor) {
    registeredPayloadExecutor(state, directive, blob, ctx?.data);
  } else {
    const fauna = getFaunaHivesState(state);
    const hive = fauna.hivesById[input.hiveId];
    if (hive && input.decisionIndex > hive.decisionIndex) {
      hive.decisionIndex = input.decisionIndex;
      saveFaunaHivesState(state, fauna, input.effectiveTick);
    }
  }

  blob.log.push(directive);
  if (blob.log.length > MAX_DIRECTIVE_LOG) blob.log.splice(0, blob.log.length - MAX_DIRECTIVE_LOG);
  blob.appliedSeqs.push(seq);
  blob.pendingOutbox.push(cloneFaunaDirective(directive));

  saveFaunaDirectivesState(state, blob, ctx?.tick ?? input.effectiveTick ?? state.meta.tick);
  return cloneFaunaDirective(directive);
}

/** Returns and clears `pendingOutbox` of directives emitted since the last wire flush. */
export function drainFaunaDirectivesOutbox(state: PlanetState): FaunaDirective[] {
  const blob = getFaunaDirectivesState(state);
  if (blob.pendingOutbox.length === 0) return [];
  const drained = blob.pendingOutbox.map(cloneFaunaDirective);
  blob.pendingOutbox = [];
  saveFaunaDirectivesState(state, blob, state.meta.tick);
  return drained;
}

/** Queries the bounded directive replay log on `state` for all directives after `afterSeq`. */
export function getFaunaDirectivesSince(
  state: PlanetState,
  afterSeq: number,
  expectedVersion = FAUNA_DIRECTIVE_VERSION,
): FaunaDirectivesSinceResult {
  const blob = getFaunaDirectivesState(state);
  const earliestSeq = blob.log[0]?.seq ?? blob.lastSeq + 1;
  if (blob.version !== FAUNA_DIRECTIVE_VERSION || expectedVersion !== FAUNA_DIRECTIVE_VERSION) {
    return { ok: false, reason: 'version_mismatch', earliestSeq };
  }
  if (afterSeq >= blob.lastSeq) return { ok: true, directives: [] };
  if (blob.log.length === 0 || afterSeq + 1 < earliestSeq) {
    return { ok: false, reason: 'log_gap', earliestSeq };
  }
  return { ok: true, directives: blob.log.filter((d) => d.seq > afterSeq).map(cloneFaunaDirective) };
}

function isFaunaBugKind(entityKind: number): boolean {
  return (
    entityKind === ENTITY_KIND.blackAnt ||
    entityKind === ENTITY_KIND.blueBeetle ||
    entityKind === ENTITY_KIND.greenSpitter
  );
}

export interface FaunaRowDiffSample {
  x: number;
  y: number;
  rot: number;
  q?: number;
  r?: number;
  targetQ?: number;
  targetR?: number;
  hp: number;
  state: number;
}

/** Computes a `FAUNA_DIFF_MASK` bitmask comparing two snapshots of an entity row. */
export function computeFaunaRowChangedMask(
  prev: FaunaRowDiffSample,
  next: FaunaRowDiffSample,
  isNewSpawn = false,
): number {
  let mask = isNewSpawn ? FAUNA_DIFF_MASK.spawn : 0;
  if (Math.abs(prev.x - next.x) > 1e-6) mask |= FAUNA_DIFF_MASK.x;
  if (Math.abs(prev.y - next.y) > 1e-6) mask |= FAUNA_DIFF_MASK.y;
  if (Math.abs(prev.rot - next.rot) > 1e-6) mask |= FAUNA_DIFF_MASK.rot;
  if (prev.q !== undefined && next.q !== undefined && prev.q !== next.q) mask |= FAUNA_DIFF_MASK.q;
  if (prev.r !== undefined && next.r !== undefined && prev.r !== next.r) mask |= FAUNA_DIFF_MASK.r;
  if (prev.targetQ !== undefined && next.targetQ !== undefined && prev.targetQ !== next.targetQ) {
    mask |= FAUNA_DIFF_MASK.targetQ;
  }
  if (prev.targetR !== undefined && next.targetR !== undefined && prev.targetR !== next.targetR) {
    mask |= FAUNA_DIFF_MASK.targetR;
  }
  if (Math.abs(prev.hp - next.hp) > 1e-6) mask |= FAUNA_DIFF_MASK.hp;
  if (prev.state !== next.state) mask |= FAUNA_DIFF_MASK.state;
  return mask;
}

/**
 * Returns `true` when `entityKind` is a fauna bug and the routine tick diff only changed
 * reconstructible motion (`x, y, rot, q, r`) on a non-correction tick (`tick % 25 !== 0`).
 */
export function shouldOmitFaunaTransformFromRoutineDiff(
  entityKind: number,
  changedMask: number,
  tick?: number,
): boolean {
  if (!isFaunaBugKind(entityKind) || changedMask === 0) return false;
  if (tick !== undefined && tick > 0 && tick % FAUNA_CORRECTION_INTERVAL_TICKS === 0) return false;
  if ((changedMask & ~FAUNA_RECONSTRUCTIBLE_MOTION_MASK) !== 0) return false;
  return (changedMask & FAUNA_RECONSTRUCTIBLE_MOTION_MASK) !== 0;
}

function hasBugSnapshotChanged(prev: FaunaBugWireSnapshot | undefined, next: FaunaBugWireSnapshot): boolean {
  if (!prev) return true;
  if (Math.abs(prev.hp - next.hp) > 1e-5 || prev.q !== next.q || prev.r !== next.r) return true;
  if (Math.abs(prev.x - next.x) > 1e-5 || Math.abs(prev.y - next.y) > 1e-5) return true;
  return prev.orderKind !== next.orderKind || prev.targetQ !== next.targetQ || prev.targetR !== next.targetR;
}

/** Builds a sparse correction on a 5-second (`25` ticks) cadence for changed live fauna bugs. */
export function buildFaunaSparseCorrection(
  state: PlanetState,
  tick = state.meta.tick,
): FaunaSparseCorrection | null {
  if (tick <= 0 || tick % FAUNA_CORRECTION_INTERVAL_TICKS !== 0) return null;
  const blob = getFaunaDirectivesState(state);
  if (blob.lastCorrectionTick === tick) return null;

  const fauna = getFaunaHivesState(state);
  const cols = state.entities.cols;
  const bugIds = Object.keys(fauna.bugsById)
    .map(Number)
    .sort((a, b) => a - b);
  const changedBugs: FaunaSparseBugRecord[] = [];
  const nextSnapshots: Record<number, FaunaBugWireSnapshot> = {};

  for (const bugId of bugIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug) continue;
    const row = rowOf(state.entities, bug.entityId);
    if (row < 0 || cols.hp[row]! <= 0) continue;
    const cmd = getUnitCommand(state, bug.entityId);
    const snap: FaunaBugWireSnapshot = {
      hp: cols.hp[row]!,
      q: cols.q[row]!,
      r: cols.r[row]!,
      x: cols.x[row]!,
      y: cols.y[row]!,
      ...(cmd?.kind ? { orderKind: cmd.kind } : {}),
      targetQ: cols.targetQ[row]!,
      targetR: cols.targetR[row]!,
    };
    nextSnapshots[bug.entityId] = snap;
    if (hasBugSnapshotChanged(blob.lastSentBugSnapshots[bug.entityId], snap)) {
      changedBugs.push({ entityId: bug.entityId, hiveId: bug.homeHiveId, ...snap });
    }
  }

  blob.lastCorrectionTick = tick;
  blob.lastSentBugSnapshots = nextSnapshots;
  saveFaunaDirectivesState(state, blob, tick);
  return changedBugs.length > 0 ? { tick, seq: blob.lastSeq, bugs: changedBugs } : null;
}

/** Advances gameplay RNG for `hiveId` using versioned domain `(planetSeed, hiveId, decisionIndex)`. */
export function nextFaunaGameplayRng(
  state: PlanetState,
  hiveId: number,
  tick = state.meta.tick,
): { rng: Uint32Array; decisionIndex: number } {
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[hiveId];
  const decisionIndex = hive ? ++hive.decisionIndex : 1;
  if (hive) saveFaunaHivesState(state, fauna, tick);
  const rng = seedStream(
    String(state.meta.seed),
    `fauna:v${FAUNA_DIRECTIVE_VERSION}:hive:${hiveId}:dec:${decisionIndex}`,
  );
  const draw = nextU32(rng);
  state.rng.fauna[0] = (state.rng.fauna[0]! ^ draw) >>> 0;
  nextU32(state.rng.fauna);
  return { rng, decisionIndex };
}

/** Pure presentation/cosmetic RNG derived from `(planetSeed, hiveId, bugId, activityEpoch, tick)`. */
export function sampleFaunaCosmeticActivity(
  planetSeed: string | number,
  hiveId: number,
  bugId: number,
  tick: number,
  activityEpoch = Math.floor(Math.max(0, tick) / FAUNA_CORRECTION_INTERVAL_TICKS),
): FaunaCosmeticSample {
  const rng = seedStream(
    String(planetSeed),
    `fauna-cosmetic:v1:hive:${hiveId}:bug:${bugId}:epoch:${activityEpoch}`,
  );
  const idx = nextInt(rng, 0, COSMETIC_ACTIVITIES.length - 1);
  const basePhase = nextFloat(rng);
  const headingOffset = (nextFloat(rng) - 0.5) * 0.6;
  const phase = (basePhase + (Math.max(0, tick) % FAUNA_CORRECTION_INTERVAL_TICKS) / FAUNA_CORRECTION_INTERVAL_TICKS) % 1;
  return { activity: COSMETIC_ACTIVITIES[idx] ?? 'idle', phase, headingOffset };
}
