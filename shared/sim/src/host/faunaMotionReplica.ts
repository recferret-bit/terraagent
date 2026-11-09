import { FAUNA_MOTION_SEED, faunaMotionSeed, installFaunaMotionSeed, type FaunaMotionSeed } from '../codec/faunaMotionSeed';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { rowOf } from '../ecs/store';
import { applyFaunaDirective } from '../systems/fauna/checkpoints';
import { getFaunaDirectivesState, type FaunaDirectivesBlob, type FaunaDirective } from '../systems/fauna/directives';
import { makeDirectiveStepCtx } from '../systems/fauna/directivePayloads';
import { stepFaunaMovement } from '../systems/fauna/step';
import { speciesOfEntityKind } from '../systems/fauna/types';
import { stepUnits } from '../systems/units/registry';
import { cancelMove } from '../units/movement/orchestrator';
import { clone } from './clone';
import { applyDiff, decodeDiff, DiffGapError, reconstructEntityMotion, reconstructTerrainAtTick } from './diff';

/** Isolated motion reconstruction: speculative orders never mutate the authoritative economy or combat state. */
export class FaunaMotionReplica {
  private shadow: PlanetState | null = null;
  private readonly pendingDirectives = new Map<number, FaunaDirective>();

  welcome(state: PlanetState, _data: CompiledDataLike): void {
    this.shadow = clone(state);
    this.pendingDirectives.clear();
    const seed = this.shadow.blobs[FAUNA_MOTION_SEED]?.value as FaunaMotionSeed | undefined;
    if (seed) {
      installFaunaMotionSeed(this.shadow, seed);
      installFaunaMotionSeed(state, seed);
    }
    delete this.shadow.blobs[FAUNA_MOTION_SEED];
    delete state.blobs[FAUNA_MOTION_SEED];
  }

  apply(bytes: Uint8Array, authority: PlanetState, data: CompiledDataLike): void {
    const state = this.shadow;
    if (!state) throw new Error('fauna motion replica requires welcome');
    const diff = decodeDiff(bytes);
    if (diff.chunk && diff.chunk.index > 0) {
      applyDiff(state, bytes);
      return;
    }
    if (state.meta.tick !== diff.fromTick) throw new DiffGapError(state.meta.tick, diff.fromTick);
    const log = (diff.blobs.faunaDirectives?.value as FaunaDirectivesBlob | undefined)?.log ?? [];
    const knownSeq = getFaunaDirectivesState(state).lastSeq;
    for (const directive of log) {
      if (directive.seq <= knownSeq) continue;
      if (directive.effectiveTick <= diff.fromTick && !this.pendingDirectives.has(directive.seq)) {
        throw new Error('late fauna directive requires a fresh welcome');
      }
      this.pendingDirectives.set(directive.seq, directive);
    }
    for (let tick = diff.fromTick + 1; tick <= diff.toTick; tick++) {
      reconstructTerrainAtTick(state, diff, tick);
      const pending = [...this.pendingDirectives.values()].sort((a, b) => a.effectiveTick - b.effectiveTick || a.seq - b.seq);
      for (const directive of pending.filter(d => d.effectiveTick <= tick)) {
        const result = applyFaunaDirective(state, directive, { data, sourceLog: log });
        if (result.status === 'gap_detected' || result.status === 'version_mismatch') throw new Error(`fauna replay ${result.status}`);
        this.pendingDirectives.delete(directive.seq);
      }
      const ctx = makeDirectiveStepCtx(state, tick, data);
      stepFaunaMovement(state, ctx);
      stepUnits(state, ctx);
      state.meta.tick = tick;
    }
    const corrected = new Set(Array.from(diff.entities.cols.id ?? []));
    const drifted: number[] = [];
    for (let i = 0; i < diff.entities.cols.id.length; i++) {
      const id = diff.entities.cols.id[i], row = rowOf(state.entities, id);
      if (row < 0 || !speciesOfEntityKind(state.entities.cols.kind[row])) continue;
      if (['x', 'y', 'q', 'r'].some(field => state.entities.cols[field][row] !== diff.entities.cols[field][i])) drifted.push(id);
    }
    const omitted: number[] = [];
    for (let row = 0; row < authority.entities.count; row++) {
      const id = authority.entities.cols.id[row];
      if (speciesOfEntityKind(authority.entities.cols.kind[row]) && !corrected.has(id)) omitted.push(id);
    }
    reconstructEntityMotion(authority, state, omitted);
    // Apply the authoritative frame to the shadow, retaining private route/search state between frames.
    state.meta.tick = diff.fromTick;
    const appliedDirectives = state.blobs.faunaDirectives ?? { changedAt: diff.fromTick, value: getFaunaDirectivesState(state) };
    applyDiff(state, bytes);
    state.blobs.faunaDirectives = appliedDirectives;
    const routed = new Set((diff.faunaMotion?.value as FaunaMotionSeed | undefined)?.ids ?? []);
    for (const id of drifted) {
      // A correction can jump off a locally reconstructed route; request the authoritative goal anew.
      if (!routed.has(id)) cancelMove(state, id, diff.toTick);
    }
    const seed = faunaMotionSeed(state)?.value as FaunaMotionSeed | undefined;
    if (seed) installFaunaMotionSeed(authority, seed);
  }
}
