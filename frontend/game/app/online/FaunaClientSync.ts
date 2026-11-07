import { applyFaunaDirective, applyFaunaSparseCorrection, FaunaReplicaController, type ApplyFaunaDirectiveOptions, type ApplyFaunaDirectiveResult, type CompiledDataLike, type FaunaCheckpoint, type FaunaDirective, type FaunaSparseCorrection, type PlanetState } from '@terra/sim';

function remember<T>(set: Set<T>, value: T): void {
  set.add(value);
  if (set.size > 2048) set.delete(set.values().next().value!);
}

/**
 * Client-side fauna directive replay and 5-second sparse correction wrapper (`W07-17`, `W07-33`).
 * Ensures duplicate directive or sparse correction deliveries are idempotent and never duplicate cohorts or bugs.
 */
export class FaunaClientSync {
  readonly replica: FaunaReplicaController;
  readonly appliedDirectiveSeqs = new Set<number>();
  readonly appliedCorrectionKeys = new Set<string>();
  duplicateDirectivesIgnored = 0;
  duplicateCorrectionsIgnored = 0;
  reconciledBugsCount = 0;
  lastCorrectionTick = -1;

  constructor(maxCheckpoints = 32) {
    this.replica = new FaunaReplicaController(maxCheckpoints);
  }

  checkpoint(state: PlanetState): FaunaCheckpoint { return this.replica.checkpoint(state); }

  restore(state: PlanetState, checkpoint: FaunaCheckpoint): void { this.replica.restore(state, checkpoint); }

  applyDirective(
    state: PlanetState,
    directive: FaunaDirective,
    opts?: Omit<ApplyFaunaDirectiveOptions, 'checkpoints'>,
  ): ApplyFaunaDirectiveResult {
    const res = applyFaunaDirective(state, directive, { ...opts, checkpoints: this.replica.checkpoints });
    if (res.status === 'duplicate_ignored') {
      this.duplicateDirectivesIgnored++;
    } else if (res.appliedSeqs) {
      for (const s of res.appliedSeqs) remember(this.appliedDirectiveSeqs, s);
    }
    return res;
  }

  applyDirectives(
    state: PlanetState,
    directives: readonly FaunaDirective[],
    opts?: Omit<ApplyFaunaDirectiveOptions, 'checkpoints'>,
  ): ApplyFaunaDirectiveResult[] {
    return directives.map((d) => this.applyDirective(state, d, opts));
  }

  applySparseCorrection(
    state: PlanetState,
    correction: FaunaSparseCorrection,
    data?: CompiledDataLike,
  ): { reconciledCount: number; spawnedCount: number; duplicate: boolean } {
    const key = `${correction.tick}:${correction.seq}`;
    if (this.appliedCorrectionKeys.has(key)) {
      this.duplicateCorrectionsIgnored++;
      return { reconciledCount: 0, spawnedCount: 0, duplicate: true };
    }
    remember(this.appliedCorrectionKeys, key);
    this.lastCorrectionTick = Math.max(this.lastCorrectionTick, correction.tick);
    const res = applyFaunaSparseCorrection(state, correction, data);
    this.reconciledBugsCount += res.reconciledCount;
    return { ...res, duplicate: false };
  }

  reset(): void {
    this.replica.checkpoints.clear();
    this.appliedDirectiveSeqs.clear();
    this.appliedCorrectionKeys.clear();
    this.duplicateDirectivesIgnored = 0;
    this.duplicateCorrectionsIgnored = 0;
    this.reconciledBugsCount = 0;
    this.lastCorrectionTick = -1;
  }
}

