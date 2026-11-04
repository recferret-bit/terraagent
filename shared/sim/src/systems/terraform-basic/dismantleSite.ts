import type { ResourceKey } from '@terra/contracts';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import type { ColonyState, SimState } from '../../kernel/state';
import { fromMicro, toMicro } from '../../economy/residual';
import { creditResource } from '../economy/ledger';

/**
 * The building side of a dismantle (owner feedback W03 #6). A building being dismantled is a site again: its `state`
 * is `constructing`, so it is offline like a site under construction (the power grid, production and auto-repair skip
 * it), and its `progress` is the share of the structure still standing (1 → 0, the site mesh comes down with it).
 * The dismantle job (`blobs.workJobs`, mode `dismantle`) is what tells it from a site being built.
 */

/** The dismantle job fields this file reads and writes. */
export interface DismantleSiteJob {
  targetEntityId?: number;
  progress: number;
  prevState?: number;
  prevProgress?: number;
  refundTotal?: Partial<Record<ResourceKey, number>>;
  refunded?: Partial<Record<ResourceKey, number>>;
  /** Share of the hull a cancel takes off per unit of progress (refund rate / repair cost rate, capped at 1). */
  hpLossRate?: number;
}

/** Turns building row `row` into a dismantling site; returns its state and progress before (kept for a cancel). */
export function beginDismantleSite(state: SimState, row: number, tick: number): { prevState: number; prevProgress: number } {
  const cols = state.entities.cols;
  const prev = { prevState: cols.state[row], prevProgress: cols.progress[row] };
  setField(state.entities, row, 'state', ENTITY_STATE.constructing, tick);
  setField(state.entities, row, 'progress', 1, tick);
  return prev;
}

/**
 * Credits the refund up to `progress` (0..1) of the job's whole refund: the slice since the last step. Credits clamp
 * at the storage cap (D-42; what does not fit is lost, `production.capped`). The last step credits exactly the rest.
 */
export function creditDismantleRefund(colony: ColonyState, job: DismantleSiteJob, progress: number, tick: number): void {
  const total = job.refundTotal ?? {};
  const refunded = { ...(job.refunded ?? {}) };
  const p = Math.max(0, Math.min(1, progress));
  for (const [k, v] of Object.entries(total) as [ResourceKey, number][]) {
    if (!v || v <= 0) continue;
    // Micro-units telescope: the credited slices add up to exactly the micro-rounded target, with no drift per step.
    const targetMicro = toMicro(p >= 1 ? v : v * p);
    const sliceMicro = targetMicro - toMicro(refunded[k] ?? 0);
    if (sliceMicro <= 0) continue;
    creditResource(colony, k, fromMicro(sliceMicro), tick, { produced: false });
    refunded[k] = fromMicro(targetMicro);
  }
  job.refunded = refunded;
}

/**
 * A cancelled dismantle: the building stands again (its old state, the power core re-checks it next step) with the
 * hull it lost: the share taken apart × `hpLossRate`, so repairing it costs about what the dismantle refunded (no
 * free resources from dismantle-and-cancel). The refund already credited stays with the colony.
 */
export function restoreDismantleSite(state: SimState, job: DismantleSiteJob, tick: number): void {
  if (job.targetEntityId === undefined) return;
  const row = rowOf(state.entities, job.targetEntityId);
  if (row < 0) return;
  const cols = state.entities.cols;
  const prevState = job.prevState ?? ENTITY_STATE.active;
  setField(state.entities, row, 'state', prevState === ENTITY_STATE.constructing ? ENTITY_STATE.active : prevState, tick);
  setField(state.entities, row, 'progress', job.prevProgress ?? 1, tick);
  const lost = Math.min(1, Math.max(0, job.progress) * (job.hpLossRate ?? 1));
  if (lost <= 0 || cols.hp[row] <= 0) return;
  const hp = Math.max(1, Math.min(cols.hp[row], Math.round(cols.hpMax[row] * (1 - lost))));
  if (hp !== cols.hp[row]) setField(state.entities, row, 'hp', hp, tick);
}
