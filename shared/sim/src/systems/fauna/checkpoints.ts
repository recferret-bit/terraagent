import { restore, snapshot } from '../../codec/snapshot';
import { linkGridMeta } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { getPendingProjectileImpacts, stepProjectileImpacts } from '../combat/projectiles';
import { stepUnits } from '../units/registry';
import {
  executeFaunaDirectivePayload,
  makeDirectiveStepCtx,
  reconcileSingleBugRecord,
} from './directivePayloads';
import {
  cloneFaunaDirective,
  FAUNA_DIRECTIVE_VERSION,
  getFaunaDirectivesState,
  MAX_DIRECTIVE_LOG,
  registerDirectivePayloadExecutor,
  saveFaunaDirectivesState,
  type FaunaDirective,
  type FaunaDirectivesBlob,
  type FaunaSparseCorrection,
} from './directives';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import { defaultFaunaData } from './types';

export { restore as decodeSnapshot, snapshot as encodeSnapshot };
export { executeFaunaDirectivePayload } from './directivePayloads';

registerDirectivePayloadExecutor(executeFaunaDirectivePayload);

export interface FaunaCheckpoint {
  tick: number;
  simVersion: number;
  directiveVersion: number;
  lastDirectiveSeq: number;
  snapshotBytes: Uint8Array;
  rng: Record<string, number[]>;
  hiveDecisionIndices: Record<number, number>;
  pendingImpactCount: number;
}

export type FaunaDirectiveApplyStatus =
  | 'applied'
  | 'duplicate_ignored'
  | 'replayed_from_checkpoint'
  | 'gap_detected'
  | 'version_mismatch';

export interface ApplyFaunaDirectiveResult {
  status: FaunaDirectiveApplyStatus;
  appliedSeqs?: number[];
  missingFromSeq?: number;
  missingToSeq?: number;
}

export class FaunaCheckpointStore {
  private readonly checkpoints: FaunaCheckpoint[] = [];
  private readonly directivesBySeq = new Map<number, FaunaDirective>();

  constructor(private readonly maxCheckpoints = 32) {}

  clear(): void {
    this.checkpoints.length = 0;
    this.directivesBySeq.clear();
  }

  save(state: PlanetState): FaunaCheckpoint {
    const cp = buildCheckpointObject(state);
    this.add(cp);
    for (const d of getFaunaDirectivesState(state).log) this.recordDirective(d);
    return cp;
  }

  add(cp: FaunaCheckpoint): void {
    const existingIdx = this.checkpoints.findIndex((item) => item.tick === cp.tick);
    if (existingIdx >= 0) this.checkpoints.splice(existingIdx, 1);
    this.checkpoints.push(cp);
    this.checkpoints.sort((a, b) => a.tick - b.tick);
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.splice(0, this.checkpoints.length - this.maxCheckpoints);
    }
  }

  getAtOrBefore(tick: number): FaunaCheckpoint | undefined {
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      if (this.checkpoints[i]!.tick <= tick) return this.checkpoints[i];
    }
    return this.checkpoints[0];
  }

  getExact(tick: number): FaunaCheckpoint | undefined {
    return this.checkpoints.find((c) => c.tick === tick);
  }

  recordDirective(directive: FaunaDirective): void {
    this.directivesBySeq.set(directive.seq, cloneFaunaDirective(directive));
    if (this.directivesBySeq.size > MAX_DIRECTIVE_LOG * 2) {
      const oldestKey = this.directivesBySeq.keys().next().value;
      if (oldestKey !== undefined) this.directivesBySeq.delete(oldestKey);
    }
  }

  getDirectivesInRange(fromSeq: number, toSeq: number): FaunaDirective[] | null {
    const out: FaunaDirective[] = [];
    for (let s = fromSeq; s <= toSeq; s++) {
      const d = this.directivesBySeq.get(s);
      if (!d) return null;
      out.push(cloneFaunaDirective(d));
    }
    return out;
  }
}

export function createFaunaCheckpointStore(maxCheckpoints = 32): FaunaCheckpointStore {
  return new FaunaCheckpointStore(maxCheckpoints);
}

const autoStoresByState = new WeakMap<PlanetState, FaunaCheckpointStore>();

function getOrCreateAutoStore(state: PlanetState): FaunaCheckpointStore {
  let store = autoStoresByState.get(state);
  if (!store) {
    store = new FaunaCheckpointStore(32);
    autoStoresByState.set(state, store);
  }
  return store;
}

function buildCheckpointObject(state: PlanetState): FaunaCheckpoint {
  const fauna = getFaunaHivesState(state);
  const directives = getFaunaDirectivesState(state);
  const rngCopy: Record<string, number[]> = {};
  for (const [k, arr] of Object.entries(state.rng)) rngCopy[k] = Array.from(arr);
  const hiveDecisionIndices: Record<number, number> = {};
  for (const hive of Object.values(fauna.hivesById)) {
    hiveDecisionIndices[hive.hiveId] = hive.decisionIndex;
  }
  return {
    tick: state.meta.tick,
    simVersion: state.meta.simVersion,
    directiveVersion: directives.version,
    lastDirectiveSeq: directives.lastSeq,
    snapshotBytes: snapshot(state),
    rng: rngCopy,
    hiveDecisionIndices,
    pendingImpactCount: getPendingProjectileImpacts(state).length,
  };
}

/** Captures an authoritative `FaunaCheckpoint` of `state` at `state.meta.tick`. */
export function createFaunaCheckpoint(
  state: PlanetState,
  store?: FaunaCheckpointStore,
): FaunaCheckpoint {
  const cp = getOrCreateAutoStore(state).save(state);
  if (store && store !== autoStoresByState.get(state)) {
    store.add(cp);
    for (const d of getFaunaDirectivesState(state).log) store.recordDirective(d);
  }
  return cp;
}

/** Restores `state` in place from `checkpoint`. */
export function restoreFaunaCheckpoint(state: PlanetState, checkpoint: FaunaCheckpoint): void {
  const restored = restore(checkpoint.snapshotBytes);
  for (const k of Object.keys(state.meta) as Array<keyof PlanetState['meta']>) delete state.meta[k];
  Object.assign(state.meta, restored.meta);

  for (const [k, arr] of Object.entries(restored.rng) as Array<
    [keyof PlanetState['rng'], Uint32Array]
  >) {
    state.rng[k] = new Uint32Array(arr);
  }

  state.grid.radius = restored.grid.radius;
  state.grid.count = restored.grid.count;
  state.grid.layers = { ...restored.grid.layers };
  linkGridMeta(state.grid, state.meta);

  state.colonies.splice(0, state.colonies.length, ...restored.colonies);
  state.entities.count = restored.entities.count;
  state.entities.capacity = restored.entities.capacity;
  state.entities.cols = restored.entities.cols;
  state.entities.removed = [...restored.entities.removed];

  for (const k of Object.keys(state.blobs)) delete state.blobs[k];
  for (const [k, v] of Object.entries(restored.blobs)) state.blobs[k] = v;
  linkGridMeta(state.grid, state.meta, state.blobs);
}

export interface ApplyFaunaDirectiveOptions {
  checkpoints?: FaunaCheckpointStore;
  checkpoint?: FaunaCheckpoint;
  sourceLog?: readonly FaunaDirective[];
  data?: CompiledDataLike;
  onStepToTick?: (state: PlanetState, targetTick: number) => void;
}

function advanceReplicaToTick(
  state: PlanetState,
  targetTick: number,
  opts?: ApplyFaunaDirectiveOptions,
): void {
  if (state.meta.tick >= targetTick) return;
  if (opts?.onStepToTick) {
    opts.onStepToTick(state, targetTick);
    state.meta.tick = targetTick;
    return;
  }
  while (state.meta.tick < targetTick) {
    const nextTick = state.meta.tick + 1;
    const ctx = makeDirectiveStepCtx(state, nextTick, opts?.data);
    stepUnits(state, ctx);
    stepProjectileImpacts(state, nextTick, ctx);
    state.meta.tick = nextTick;
  }
}

function applySingleDirectiveInOrder(
  state: PlanetState,
  directive: FaunaDirective,
  blob: FaunaDirectivesBlob,
  data?: CompiledDataLike,
): void {
  executeFaunaDirectivePayload(state, directive, blob, data);
  if (!blob.appliedSeqs.includes(directive.seq)) blob.appliedSeqs.push(directive.seq);
  if (!blob.log.some((d) => d.seq === directive.seq)) {
    blob.log.push(cloneFaunaDirective(directive));
    blob.log.sort((a, b) => a.seq - b.seq);
    if (blob.log.length > MAX_DIRECTIVE_LOG) {
      blob.log.splice(0, blob.log.length - MAX_DIRECTIVE_LOG);
    }
  }
  blob.lastSeq = Math.max(blob.lastSeq, directive.seq);
}

function drainContiguousBufferedDirectives(
  state: PlanetState,
  blob: FaunaDirectivesBlob,
  data?: CompiledDataLike,
): number[] {
  const drained: number[] = [];
  blob.bufferedGapDirectives.sort((a, b) => a.seq - b.seq);
  while (blob.bufferedGapDirectives.length > 0) {
    const head = blob.bufferedGapDirectives[0]!;
    if (head.seq <= blob.lastSeq || blob.appliedSeqs.includes(head.seq)) {
      blob.bufferedGapDirectives.shift();
      continue;
    }
    if (head.seq !== blob.lastSeq + 1) break;
    blob.bufferedGapDirectives.shift();
    applySingleDirectiveInOrder(state, head, blob, data);
    drained.push(head.seq);
  }
  if (blob.bufferedGapDirectives.length === 0) blob.predictionPaused = false;
  return drained;
}

function resolveMissingRange(
  fromSeq: number,
  toSeq: number,
  blob: FaunaDirectivesBlob,
  opts?: ApplyFaunaDirectiveOptions,
): FaunaDirective[] | null {
  const bySeq = new Map<number, FaunaDirective>();
  for (const d of blob.log) bySeq.set(d.seq, d);
  for (const d of blob.bufferedGapDirectives) bySeq.set(d.seq, d);
  if (opts?.sourceLog) for (const d of opts.sourceLog) bySeq.set(d.seq, d);
  const fromStore = opts?.checkpoints?.getDirectivesInRange(fromSeq, toSeq);
  if (fromStore) for (const d of fromStore) bySeq.set(d.seq, d);
  const out: FaunaDirective[] = [];
  for (let s = fromSeq; s <= toSeq; s++) {
    const found = bySeq.get(s);
    if (!found) return null;
    out.push(cloneFaunaDirective(found));
  }
  return out;
}

function replayLateDirectiveFromCheckpoint(
  state: PlanetState,
  cp: FaunaCheckpoint,
  directive: FaunaDirective,
  blob: FaunaDirectivesBlob,
  opts?: ApplyFaunaDirectiveOptions,
): ApplyFaunaDirectiveResult {
  const targetTick = state.meta.tick;
  const toReplay = new Map<number, FaunaDirective>();
  for (const d of blob.log) {
    if (d.seq > cp.lastDirectiveSeq) toReplay.set(d.seq, cloneFaunaDirective(d));
  }
  toReplay.set(directive.seq, cloneFaunaDirective(directive));
  for (const d of blob.bufferedGapDirectives) toReplay.set(d.seq, cloneFaunaDirective(d));
  const ordered = Array.from(toReplay.values()).sort(
    (a, b) => a.effectiveTick - b.effectiveTick || a.seq - b.seq,
  );

  restoreFaunaCheckpoint(state, cp);
  const restoredBlob = getFaunaDirectivesState(state);
  const replayedSeqs: number[] = [];
  for (const item of ordered) {
    if (item.seq !== restoredBlob.lastSeq + 1) break;
    if (state.meta.tick < item.effectiveTick) {
      advanceReplicaToTick(state, item.effectiveTick, opts);
    }
    applySingleDirectiveInOrder(state, item, restoredBlob, opts?.data);
    replayedSeqs.push(item.seq);
  }
  restoredBlob.predictionPaused = false;
  saveFaunaDirectivesState(state, restoredBlob, state.meta.tick);
  if (state.meta.tick < targetTick) advanceReplicaToTick(state, targetTick, opts);
  return { status: 'replayed_from_checkpoint', appliedSeqs: replayedSeqs };
}

/**
 * Applies a versioned, sequence-ordered `FaunaDirective` to `state` with idempotency, gap buffering,
 * and checkpoint rollback/replay for late directives (`effectiveTick < state.meta.tick`).
 */
export function applyFaunaDirective(
  state: PlanetState,
  directive: FaunaDirective,
  opts?: ApplyFaunaDirectiveOptions,
): ApplyFaunaDirectiveResult {
  const blob = getFaunaDirectivesState(state);
  if (directive.version !== FAUNA_DIRECTIVE_VERSION || blob.version !== FAUNA_DIRECTIVE_VERSION) {
    return { status: 'version_mismatch' };
  }
  if (directive.seq <= blob.lastSeq || blob.appliedSeqs.includes(directive.seq)) {
    return { status: 'duplicate_ignored' };
  }

  const store = opts?.checkpoints ?? autoStoresByState.get(state);
  store?.recordDirective(directive);

  if (directive.seq > blob.lastSeq + 1) {
    const missing = resolveMissingRange(blob.lastSeq + 1, directive.seq - 1, blob, opts);
    if (!missing) {
      blob.predictionPaused = true;
      if (!blob.bufferedGapDirectives.some((d) => d.seq === directive.seq)) {
        blob.bufferedGapDirectives.push(cloneFaunaDirective(directive));
      }
      saveFaunaDirectivesState(state, blob, state.meta.tick);
      return {
        status: 'gap_detected',
        missingFromSeq: blob.lastSeq + 1,
        missingToSeq: directive.seq - 1,
      };
    }
    for (const m of missing) applySingleDirectiveInOrder(state, m, blob, opts?.data);
  }

  if (directive.effectiveTick < state.meta.tick) {
    const cp = opts?.checkpoint ?? store?.getAtOrBefore(directive.effectiveTick);
    if (cp && cp.tick <= directive.effectiveTick) {
      return replayLateDirectiveFromCheckpoint(state, cp, directive, blob, opts);
    }
  }

  applySingleDirectiveInOrder(state, directive, blob, opts?.data);
  const drained = drainContiguousBufferedDirectives(state, blob, opts?.data);
  saveFaunaDirectivesState(state, blob, state.meta.tick);
  return { status: 'applied', appliedSeqs: [directive.seq, ...drained] };
}

/** Reconciles drifted fauna bug records `(q, r, x, y, hp)` and order targets from a `FaunaSparseCorrection`. */
export function applyFaunaSparseCorrection(
  state: PlanetState,
  correction: FaunaSparseCorrection,
  data?: CompiledDataLike,
): { reconciledCount: number; spawnedCount: number } {
  const resolvedData = data ?? defaultFaunaData();
  const fauna = getFaunaHivesState(state);
  const blob = getFaunaDirectivesState(state);
  const seenIds = new Set<number>();
  let reconciledCount = 0;
  let spawnedCount = 0;

  for (const item of correction.bugs) {
    if (seenIds.has(item.entityId)) continue;
    seenIds.add(item.entityId);
    const res = reconcileSingleBugRecord(state, fauna, item, correction.tick, resolvedData);
    if (res === 'spawned') {
      spawnedCount++;
      reconciledCount++;
    } else if (res === 'reconciled') {
      reconciledCount++;
    }
  }

  blob.lastCorrectionTick = Math.max(blob.lastCorrectionTick, correction.tick);
  blob.lastSeq = Math.max(blob.lastSeq, correction.seq);
  saveFaunaHivesState(state, fauna, correction.tick);
  saveFaunaDirectivesState(state, blob, correction.tick);
  return { reconciledCount, spawnedCount };
}

export class FaunaReplicaController {
  readonly checkpoints: FaunaCheckpointStore;

  constructor(maxCheckpoints = 32) {
    this.checkpoints = new FaunaCheckpointStore(maxCheckpoints);
  }

  checkpoint(state: PlanetState): FaunaCheckpoint {
    return createFaunaCheckpoint(state, this.checkpoints);
  }

  restore(state: PlanetState, checkpoint: FaunaCheckpoint): void {
    restoreFaunaCheckpoint(state, checkpoint);
  }

  applyDirective(
    state: PlanetState,
    directive: FaunaDirective,
    opts?: Omit<ApplyFaunaDirectiveOptions, 'checkpoints'>,
  ): ApplyFaunaDirectiveResult {
    return applyFaunaDirective(state, directive, { ...opts, checkpoints: this.checkpoints });
  }

  applySparseCorrection(
    state: PlanetState,
    correction: FaunaSparseCorrection,
    data?: CompiledDataLike,
  ): { reconciledCount: number; spawnedCount: number } {
    return applyFaunaSparseCorrection(state, correction, data);
  }
}
