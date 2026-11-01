import { colonyActor, treasury } from '../../economy';
import { ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { revealSubsurface } from '../../grid/subsurface';
import { setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { approach, setUnitActivity } from '../../units/approach';
import { faceTowards } from '../../units/movement/locomotion';
import { defineUnitCommand, type TerraformCommand, type UnitCtx, type UnitWorkProvider } from '../../units/types';
import { stepTerraformWorkWithCell, syncHqView } from '../hq';
import { getTerraformOpSpec, readOrdersByColony, writeOrdersByColony, type TerraformJob, type TerraformOrder } from './queue';

/**
 * Terraform as unit work (`UO-TF`, `UO-HQ-06`). The colony's terraform queue (`state.blobs.terraformTasks`) says WHAT
 * to do; the `terraform` unit command does it: the HQ walks (movement orchestrator) until the job tile is within its
 * terraform reach, faces it and works it with energy from its own cell. The work provider hands an idle HQ the nearest
 * queued tile, so a forest is cleared from its edge inwards and a tile the HQ cannot reach is retried later.
 */

const jobKey = (orderId: string, q: number, r: number): string => `tf:${orderId}:${q},${r}`;

function completeTerraformJob(state: PlanetState, colonyId: number, job: TerraformJob, ctx: StepContext): void {
  const tick = ctx.tick;
  const tileIdx = hexIndex(state.grid.radius).indexOf(job.q, job.r);
  if (tileIdx < 0) return;
  const col = state.colonies[colonyId];
  const colonyIdStr = col?.id ?? `col_${colonyId}`;
  const playerId = typeof col?.playerId === 'string' ? col.playerId : undefined;
  const who = { colonyId: colonyIdStr, ...(playerId ? { playerId } : {}) };
  const spec = getTerraformOpSpec(job.op, ctx.data);

  if (job.op === 'grade') {
    setTilePrep(state.grid, tileIdx, PREP.prepared, tick);
    ctx.emit({ kind: 'tilePrepared', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, count: 1, q: job.q, r: job.r } });
    return;
  }
  setTileTerrain(state.grid, tileIdx, TERRAIN.flat, tick);
  setTilePrep(state.grid, tileIdx, PREP.flat, tick);
  // Removing the obstacle uncovers what world generation buried under it (D-38, `grid/subsurface.ts`).
  const found = revealSubsurface(state, tileIdx, tick);
  if (found) ctx.emit({ kind: 'groundRevealed', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, q: job.q, r: job.r, ...found } });
  if (spec.yieldResource && spec.yieldAmount > 0) {
    treasury(state, ctx).add({
      colony: colonyId,
      amounts: { [spec.yieldResource]: spec.yieldAmount },
      reason: 'terraform.yield',
      actor: colonyActor(state, colonyId),
      ref: `tile:${job.q},${job.r}`,
    });
  }
  ctx.emit({
    kind: 'obstacleRemoved',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: { ...who, op: job.op, count: 1, q: job.q, r: job.r },
  });
}

/** One step of work by unit `row` on the first job of `order`; returns `true` when the job completed. */
function workJob(state: PlanetState, order: TerraformOrder, row: number, ctx: StepContext): boolean {
  const job = order.jobs[0];
  const tick = ctx.tick;
  const workRes = stepTerraformWorkWithCell(state, row, {
    baseTimeS: job.baseTimeS,
    totalEnergyE: job.totalEnergyE,
    dtS: (TICK_MS / 1000) * ctx.dt,
    remainingProgress: Math.max(0, 1 - job.progress),
    remainingEnergyE: Math.max(0, job.totalEnergyE - job.energyDrawnE),
    tick,
  });
  job.progress = Math.min(1, job.progress + workRes.progressDelta);
  job.energyDrawnE += workRes.energyDrawnE;
  if (job.progress < 1 - 1e-6) {
    setField(state.entities, row, 'progress', Math.fround(job.progress), tick);
    return false;
  }
  completeTerraformJob(state, order.colonyId, job, ctx);
  order.totalJobs = order.totalJobs ?? order.jobs.length;
  order.completedJobs = (order.completedJobs ?? 0) + 1;
  order.jobs.shift();
  setField(state.entities, row, 'progress', 0, tick);
  return true;
}

export const terraformCommand = defineUnitCommand<TerraformCommand>({
  kind: 'terraform',
  key: (c) => jobKey(c.orderId, c.q, c.r),
  execute(u, c) {
    const byColony = readOrdersByColony(u.state);
    const order = (byColony[u.owner] ?? []).find((o) => o.orderId === c.orderId);
    const job = order?.jobs[0];
    if (!order || !job || job.q !== c.q || job.r !== c.r) return 'done';
    const [minDist, maxDist] = u.stats.terraformReach;
    const status = approach(u, { q: c.q, r: c.r, minDist, maxDist });
    if (status !== 'arrived') return status === 'failed' ? 'failed' : 'running';

    setUnitActivity(u, ENTITY_STATE.working, c.q, c.r);
    faceTowards(u.state, u.row, c.q, c.r, u.ctx.tick);
    const completed = workJob(u.state, order, u.row, u.ctx);
    writeOrdersByColony(u.state, byColony, u.ctx.tick);
    syncHqView(u.state, u.row, u.ctx.tick, u.ctx.data);
    return completed ? 'done' : 'running';
  },
});

/** The job a unit should do next in `order`: nearest tile first (list order breaks ties), one job per tile. */
function nearestJob(u: UnitCtx, order: TerraformOrder): number {
  const cols = u.state.entities.cols;
  const seen = new Set<string>();
  let best = -1;
  let bestD = Infinity;
  order.jobs.forEach((job, i) => {
    const tile = `${job.q},${job.r}`;
    if (seen.has(tile)) return; // a tile's later job (Grade after Clear) waits for its first
    seen.add(tile);
    if ((u.record.skip[jobKey(order.orderId, job.q, job.r)] ?? 0) > u.ctx.tick) return;
    const d = hexDistance(cols.q[u.row], cols.r[u.row], job.q, job.r);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

export const terraformProvider: UnitWorkProvider = {
  id: 'terraform',
  propose(u) {
    const byColony = readOrdersByColony(u.state);
    const orders = byColony[u.owner] ?? [];
    const cur = u.record.current;
    if (cur?.kind === 'terraform') {
      const job = orders.find((o) => o.orderId === cur.orderId)?.jobs[0];
      const skipped = (u.record.skip[jobKey(cur.orderId, cur.q, cur.r)] ?? 0) > u.ctx.tick;
      if (job && job.q === cur.q && job.r === cur.r && !skipped) return cur; // keep working the job already started
    }
    for (const order of orders) {
      const at = nearestJob(u, order);
      if (at < 0) continue;
      const [job] = order.jobs.splice(at, 1);
      order.jobs.unshift(job);
      if (at !== 0) writeOrdersByColony(u.state, byColony, u.ctx.tick);
      return { kind: 'terraform', source: 'auto', orderId: order.orderId, q: job.q, r: job.r };
    }
    return null;
  },
};
