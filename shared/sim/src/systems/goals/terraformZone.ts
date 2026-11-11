import { hexDistance, hexIndex } from '../../grid/hex';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { getConstructionOrders } from '../construction/orders';
import { entityFootprint, getBuildingFootprintTiles } from '../construction/placement';
import { ENTITY_KIND } from '../../ecs/columns';
import { getColonyQueue } from '../queue';
import { enqueueWorkAtTile } from '../terraform-basic/dismantleAndWork';
import { evaluateGroundWorkTile } from '../terraform-basic/groundWorkRule';
import { colonyTerraformOrders } from '../terraform-basic/orders';
import { enqueueTerraformOrder } from '../terraform-basic/queue';
import {
  colonyTerraformStats,
  resolveCultivateTileOp,
  syncColonyTerraformStats,
  terraformWorldFromState,
  type CultivateOpKind,
} from '../terraform-basic/rules';
import { getWorkJobsMap } from '../terraform-basic/workJobs';
import { completeColonyGoal } from './index';
import { findColonyAnchor } from './sites';
import { emitGoalProgress, saveColonyGoals } from './store';
import type { ColonyGoalEntry } from './types';

interface ZoneCandidate {
  q: number;
  r: number;
  rank: number;
  dist: number;
  kind: 'cultivate' | 'work';
  op?: CultivateOpKind;
  affordable: boolean;
}

function stockOf(state: PlanetState, colonyIndex: number, key: string): number {
  const stock = (state.colonies[colonyIndex] as { stock?: Record<string, number> } | undefined)?.stock;
  return Number(stock?.[key] ?? 0);
}

function canAffordCultivateStep(state: PlanetState, colonyIndex: number, op: CultivateOpKind): boolean {
  const water = stockOf(state, colonyIndex, 'bio.water');
  const minerals = stockOf(state, colonyIndex, 'minerals.t1');
  const desert = state.meta.planetType === 'desert' || state.meta.planetType === 'dune';
  if (op === 'grade') return minerals >= 4;
  if (op === 'irrigate') return water >= (desert ? 40 : 25);
  return water >= 20 && minerals >= 10;
}

function hasOpenColonyTerraformWork(state: PlanetState, colonyIndex: number): boolean {
  if (colonyTerraformOrders(state, colonyIndex).length > 0) return true;
  for (const job of Object.values(getWorkJobsMap(state))) {
    if (job.colonyId === colonyIndex && job.mode === 'terraform') return true;
  }
  return false;
}

function pendingConstructionTileSet(state: PlanetState, colonyIndex: number): Set<string> {
  const out = new Set<string>();
  const addFootprint = (building: string, q: number, r: number): void => {
    const kind = (ENTITY_KIND as Record<string, number>)[building];
    const size = kind !== undefined ? entityFootprint(kind) : 2;
    for (const t of getBuildingFootprintTiles(q, r, size)) out.add(`${t.q},${t.r}`);
  };
  for (const o of getConstructionOrders(state, colonyIndex)) {
    if (o.status !== 'completed' && o.status !== 'cancelled') addFootprint(o.building, o.q, o.r);
  }
  for (const e of getColonyQueue(state, colonyIndex, 'construction')) {
    if (e.state !== 'done' && e.state !== 'cancelled' && e.task.kind === 'build') {
      addFootprint(e.task.building, e.task.q, e.task.r);
    }
  }
  return out;
}

function pickBestZoneCandidate(
  state: PlanetState,
  colonyIndex: number,
  center: { q: number; r: number },
  maxRadius: number,
  ctx?: StepContext,
): { best: ZoneCandidate | null; blockedByReserves: boolean } {
  const world = terraformWorldFromState(state, colonyIndex, ctx?.data);
  const reserved = pendingConstructionTileSet(state, colonyIndex);
  const hx = hexIndex(state.grid.radius);
  const deposit = state.grid.layers.deposit;
  let best: ZoneCandidate | null;
  best = null;
  let blockedByReserves = false;

  const preferBetter = (cand: ZoneCandidate): void => {
    if (
      !best ||
      cand.rank < best.rank ||
      (cand.rank === best.rank && cand.dist < best.dist)
    ) {
      best = cand;
    }
  };

  for (let i = 0; i < state.grid.count; i++) {
    if (state.grid.layers.owner[i] !== colonyIndex) continue;
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    if (reserved.has(`${q},${r}`)) continue;
    const dist = hexDistance(center.q, center.r, q, r);
    if (dist > maxRadius) continue;

    const cult = resolveCultivateTileOp(world, colonyIndex, q, r, { data: ctx?.data, deposit });
    if (cult.ok) {
      const affordable = canAffordCultivateStep(state, colonyIndex, cult.op);
      if (!affordable) {
        blockedByReserves = true;
        continue;
      }
      const rank = cult.op === 'seed' ? 0 : cult.op === 'irrigate' ? 1 : 2;
      preferBetter({ q, r, rank, dist, kind: 'cultivate', op: cult.op, affordable: true });
      continue;
    }

    const ground = evaluateGroundWorkTile(world, colonyIndex, i, q, r, {
      deposit,
      occupied: world.occupied?.has(i),
      data: ctx?.data,
    });
    if (ground.ok) {
      preferBetter({ q, r, rank: 3, dist, kind: 'work', affordable: true });
    }
  }
  return { best, blockedByReserves };
}

/**
 * Executor for `terraform_zone` ("Terraform Zone", `W05`):
 * Advances owned ground around the colony anchor (or `goal.params.q / r`) through obstacle clearing +
 * `grade → irrigate → seed` to `Living` while preserving Water & Minerals reserves.
 */
export function stepTerraformZoneGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[],
  tick: number,
  ctx?: StepContext,
): void {
  const stats = syncColonyTerraformStats(state, colonyIndex, tick);
  const defaultTarget = Math.min(Math.max(1, stats.eligibleOwnedTiles || 3), stats.livingTiles + 3);
  const targetLiving =
    typeof goal.params.target === 'number' && goal.params.target > 0
      ? Math.max(1, Math.trunc(goal.params.target))
      : defaultTarget;
  goal.params.target = targetLiving;

  if (stats.livingTiles >= targetLiving) {
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  const anchor = findColonyAnchor(state, colonyIndex);
  const center = {
    q: typeof goal.params.q === 'number' ? goal.params.q : anchor.q,
    r: typeof goal.params.r === 'number' ? goal.params.r : anchor.r,
  };
  const maxRadius = typeof goal.params.radius === 'number' ? goal.params.radius : 12;

  if (hasOpenColonyTerraformWork(state, colonyIndex)) {
    goal.detail = `${stats.livingTiles} / ${targetLiving} Living hexes (${stats.percent}%). Cultivating queued ground.`;
  } else {
    const { best, blockedByReserves } = pickBestZoneCandidate(state, colonyIndex, center, maxRadius, ctx);
    if (best && best.kind === 'cultivate' && best.op) {
      const taskId = `${goal.id}:tf:${tick}`;
      const res = enqueueTerraformOrder(state, {
        colonyId: colonyIndex,
        op: best.op,
        tiles: [{ q: best.q, r: best.r }],
        taskId,
        tick,
        data: ctx?.data,
      });
      goal.detail = res.ok
        ? `${stats.livingTiles} / ${targetLiving} Living hexes. Ordered ${best.op} at (${best.q},${best.r}).`
        : `${stats.livingTiles} / ${targetLiving} Living hexes. Waiting (${res.reason ?? 'queue_busy'}).`;
    } else if (best && best.kind === 'work') {
      const taskId = `${goal.id}:wk:${tick}`;
      const res = enqueueWorkAtTile(state, colonyIndex, best.q, best.r, {
        taskId,
        tick,
        data: ctx?.data,
        chain: false,
      });
      goal.detail = res.ok
        ? `${stats.livingTiles} / ${targetLiving} Living hexes. Clearing obstacle at (${best.q},${best.r}).`
        : `${stats.livingTiles} / ${targetLiving} Living hexes. Waiting (${res.reason}).`;
    } else if (blockedByReserves) {
      goal.detail = `${stats.livingTiles} / ${targetLiving} Living hexes. Holding Water/Minerals reserves before irrigating.`;
    } else {
      goal.detail = `${stats.livingTiles} / ${targetLiving} Living hexes. Waiting for eligible owned ground.`;
    }
  }

  const nextProgress = Number(Math.min(0.95, stats.livingTiles / Math.max(1, targetLiving)).toFixed(2));
  const changed = nextProgress !== goal.progress || goal.stepsCompleted !== stats.livingTiles || goal.stepsTotal !== targetLiving;
  goal.stepsTotal = targetLiving;
  goal.stepsCompleted = stats.livingTiles;
  goal.progress = nextProgress;
  saveColonyGoals(state, colonyIndex, goals, tick);
  if (changed) emitGoalProgress(ctx, colonyIndex, goal);
}
