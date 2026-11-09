import { colonyActor, reportTreasuryReject, treasury, type AddRequest, type Amounts } from '../../economy';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { isTileUneven } from '../../grid/geo';
import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { joinPlaneHeight } from '../../grid/hexTile';
import { TERRAIN } from '../../grid/layers';
import { regionalClearingYields } from '../../economy/regions/sources';
import { revealAroundChanged } from '../../grid/subsurface';
import { prepKeyFromId, setTileHeight, setTilePrep, setTileTerrain, terrainKeyFromId } from '../../grid/tileModel';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { approach, atGoal, setUnitActivity } from '../../units/approach';
import { ensureColony } from '../economy/buildingRows';
import { maxAffordableProgress, payProgressiveSlice } from '../economy/ledger';
import { colonyWho } from '../find';
import { faceTowards } from '../../units/movement/locomotion';
import { defineUnitCommand, type TerraformCommand, type UnitCtx, type UnitWorkProvider } from '../../units/types';
import { canDoWork, isWorkerEligibleForJob } from '../dispatch/eligibility';
import { hqCellGridLinked, stepTerraformWorkWithCell } from '../hq/cell';
import { syncHqView } from '../hq/view';
import { invalidateExtractorRingCache } from '../production/tierGate';
import { getTerraformJobCost, getTerraformOpSpec, isW01TerraformOpKind } from './ops';
import { colonyTerraformOrders, readColonyOrders, writeColonyOrders, type TerraformJob, type TerraformOrder } from './orders';
import { evaluateTerraformTile, syncColonyTerraformStats, terraformWorldFromState } from './rules';

/**
 * Terraform as unit work (`UO-TF`, `UO-HQ-06`). The colony's terraform queue (`state.blobs.terraformTasks`) says WHAT
 * to do; the `terraform` unit command does it: the HQ walks (movement orchestrator) until the job tile is within its
 * terraform reach, faces it and works it with energy from its own cell. The work provider hands an idle HQ the nearest
 * queued tile, so a forest is cleared from its edge inwards and a tile the HQ cannot reach is retried later.
 *
 * A job is checked against the terraform rule again when it is picked and right before it completes (GP-01): a tile
 * that changed (worked by another order, re-generated, claimed by another colony) is dropped without work or yield,
 * so one tile never pays its yield twice.
 */

const jobKey = (orderId: string, q: number, r: number): string => `tf:${orderId}:${q},${r}`;

/** The colony's id string and the `colonyId` / `playerId` fields of its player events. */
export { colonyWho };

/** Whether `order`'s job may still run on its tile (the enqueue rule, with the order's own `allowUnclaimed`). */
function jobStillValid(state: PlanetState, order: TerraformOrder, job: TerraformJob, data: StepContext['data']): boolean {
  const world = terraformWorldFromState(state, order.colonyId, data);
  return evaluateTerraformTile(world, order.colonyId, job.op, job.q, job.r, { allowUnclaimed: order.allowUnclaimed, data }).ok;
}

/** Drops job `at` of `order` (no work, no yield): it no longer applies to its tile. */
function dropJob(order: TerraformOrder, at: number): void {
  order.jobs.splice(at, 1);
  order.skippedCount++;
}

/** Levels a newly cleared/broken flat tile onto the plane of the adjacent level flat ground (R4, `joinPlaneHeight`). */
export function levelToAdjacentFlat(state: PlanetState, tileIdx: number, tick: number): void {
  const hx = hexIndex(state.grid.radius);
  const q = hx.q[tileIdx]!, r = hx.r[tileIdx]!;
  const { terrain, height } = state.grid.layers;
  const peers: number[] = [];
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j >= 0 && terrain[j] === TERRAIN.flat && !isTileUneven(state.grid.radius, j, terrain, height)) {
      peers.push(height[j]);
    }
  }
  const plane = joinPlaneHeight(peers); // R4: the plane most level neighbours share
  if (plane !== null) {
    if (height[tileIdx] !== plane) setTileHeight(state.grid, tileIdx, plane, tick);
  } else if (Math.abs(height[tileIdx]) > 0.15) {
    setTileHeight(state.grid, tileIdx, 0, tick);
  }
}

/**
 * Changed ground uncovers what world generation buried (D-38): on the changed tile and its neighbours, every buried
 * deposit whose tile is now a hex tile (`revealAroundChanged`, `grid/subsurface.ts`) appears, one `groundRevealed` each.
 */
function emitRevealed(state: PlanetState, tileIdx: number, ctx: StepContext, colonyIdStr: string, who: ReturnType<typeof colonyWho>['who']): void {
  for (const found of revealAroundChanged(state, [tileIdx], ctx.tick)) {
    ctx.emit({ kind: 'groundRevealed', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, ...found } });
  }
}

/** A tile a terraform just changed (an order job or a dock `work` job): where, what it was, and the op. */
export interface TerraformedTile {
  tileIdx: number;
  q: number;
  r: number;
  prevTerrain: string;
  prevPrep: string;
  op: string;
  /** Tiles the one job changed (a dune disc clears several). */
  count?: number;
}

/**
 * The bookkeeping after every terraform tile change, one service for the order path and the dock `work` path: the
 * colony's Terraform % (`UO-TF-06`: a reclaimed deep tile joins the denominator), the tier-gate ring cache (W05-34) and,
 * with W05 on, `tileStateChanged` with the tile's terrain / prep as it is now.
 */
export function noteTileTerraformed(state: PlanetState, colonyId: number, t: TerraformedTile, ctx: StepContext): void {
  syncColonyTerraformStats(state, colonyId, ctx.tick);
  invalidateExtractorRingCache(state);
  if (!ctx.flags.has('W05')) return;
  const { colonyIdStr, who } = colonyWho(state, colonyId);
  const L = state.grid.layers;
  ctx.emit({
    kind: 'tileStateChanged',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: {
      ...who, q: t.q, r: t.r, prevTerrain: t.prevTerrain, prevPrep: t.prevPrep,
      terrain: terrainKeyFromId(L.terrain[t.tileIdx]), prep: prepKeyFromId(L.prep[t.tileIdx]), op: t.op,
      ...(t.count !== undefined && t.count > 1 ? { count: t.count } : {}),
    },
  });
}

function completeTerraformJob(state: PlanetState, colonyId: number, job: TerraformJob, ctx: StepContext): void {
  const tick = ctx.tick;
  const tileIdx = hexIndex(state.grid.radius).indexOf(job.q, job.r);
  if (tileIdx < 0) return;
  const { colonyIdStr, who } = colonyWho(state, colonyId);
  const spec = getTerraformOpSpec(job.op, ctx.data);
  const changed: TerraformedTile = {
    tileIdx, q: job.q, r: job.r, op: job.op,
    prevTerrain: terrainKeyFromId(state.grid.layers.terrain[tileIdx]),
    prevPrep: prepKeyFromId(state.grid.layers.prep[tileIdx]),
  };
  if (spec.toTerrain === spec.fromTerrain) {
    setTilePrep(state.grid, tileIdx, spec.toPrep, tick);
    if (job.op === 'grade') levelToAdjacentFlat(state, tileIdx, tick);
    noteTileTerraformed(state, colonyId, changed, ctx);
    if (job.op === 'seed') {
      ctx.emit({ kind: 'obstacleRemoved', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, op: 'seed', count: 1, q: job.q, r: job.r } });
    } else {
      ctx.emit({ kind: 'tilePrepared', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, count: 1, q: job.q, r: job.r } });
    }
    emitRevealed(state, tileIdx, ctx, colonyIdStr, who);
    return;
  }
  setTileTerrain(state.grid, tileIdx, spec.toTerrain, tick);
  setTilePrep(state.grid, tileIdx, spec.toPrep, tick);
  if (spec.toTerrain === TERRAIN.flat) levelToAdjacentFlat(state, tileIdx, tick);
  noteTileTerraformed(state, colonyId, changed, ctx);
  emitRevealed(state, tileIdx, ctx, colonyIdStr, who);
  const overflow = creditYield(state, colonyId, job, ctx);
  ctx.emit({
    kind: 'obstacleRemoved',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: { ...who, op: job.op, count: 1, q: job.q, r: job.r, ...(overflow ? { overflow } : {}) },
  });
}

/**
 * Credits the op's yield (`terraform.yield`) up to the colony's storage caps. What does not fit is posted to
 * `sys:overflow` (LED-11) and returned (reported in `obstacleRemoved.overflow`); a rejected yield (bad data) is
 * reported as a `treasuryRejected` warning.
 */
function creditYield(state: PlanetState, colonyId: number, job: TerraformJob, ctx: StepContext): Amounts | undefined {
  const spec = getTerraformOpSpec(job.op, ctx.data);
  const yields = regionalClearingYields(state, spec.yields); // W13-51: regional clearing yield (identity without a pinned region)
  if (Object.values(yields).every((v) => !v)) return undefined;
  const req: AddRequest = {
    colony: colonyId,
    amounts: { ...yields },
    reason: 'terraform.yield',
    actor: colonyActor(state, colonyId),
    ref: `tile:${job.q},${job.r}`,
    clampToCap: true,
  };
  const res = treasury(state, ctx).add(req);
  if (!res.ok) {
    reportTreasuryReject(ctx, state, req, res);
    return undefined;
  }
  return Object.keys(res.overflow).length > 0 ? res.overflow : undefined;
}

function findOrderTileJobIndex(order: TerraformOrder, q: number, r: number): number {
  return order.jobs.findIndex((j) => j.q === q && j.r === r);
}

function isJobShedByPower(state: PlanetState, order: TerraformOrder, job: TerraformJob): boolean {
  const power = state.colonies[order.colonyId]?.power as { shedWorkJobIds?: readonly string[] } | undefined;
  return Boolean(power?.shedWorkJobIds?.includes(`${order.orderId}:${job.q},${job.r}`));
}

function syncOrderWaitState(order: TerraformOrder): void {
  const assigned = order.jobs.filter((j) => j.assignedUnitId !== undefined);
  const firstWait = assigned.find((j) => j.waitReason !== undefined)?.waitReason;
  const allWaiting = assigned.length > 0 && assigned.every((j) => j.waitReason !== undefined);
  order.status = allWaiting ? 'waiting' : 'in_progress';
  order.waitReason = allWaiting ? firstWait : undefined;
}

/** One step of work by unit `row` on job `jobIdx` of `order`; returns `true` when the job ended (done or dropped). */
function workJob(state: PlanetState, order: TerraformOrder, jobIdx: number, row: number, ctx: StepContext): boolean {
  const job = order.jobs[jobIdx];
  if (!job) return true;
  const tick = ctx.tick;
  if (isJobShedByPower(state, order, job)) {
    job.status = 'waiting';
    job.waitReason = 'power';
    return false;
  }
  const totalCost = job.totalCost ?? getTerraformJobCost(job.op, ctx.data, state.meta.planetType);
  const hasCost = Object.keys(totalCost).length > 0;
  const fullRem = Math.max(0, 1 - job.progress);
  let remainingProgress = fullRem;
  if (hasCost) {
    const colony = ensureColony(state, order.colonyId, tick);
    const spentCost = (job.spentCost ??= {});
    const maxProg = maxAffordableProgress(colony, totalCost, spentCost, 1);
    if (maxProg <= job.progress + 1e-6) {
      job.status = 'waiting';
      job.waitReason = 'resources';
      setField(state.entities, row, 'state', ENTITY_STATE.waiting, tick);
      return false;
    }
    remainingProgress = Math.min(fullRem, Math.max(0, maxProg - job.progress));
  }
  const fullRemE = Math.max(0, job.totalEnergyE - job.energyDrawnE);
  const remainingEnergyE = fullRem > 1e-6 ? fullRemE * (remainingProgress / fullRem) : fullRemE;
  const gridPowered = !isW01TerraformOpKind(job.op) && hqCellGridLinked(state, order.colonyId, ctx.data);
  const workRes = stepTerraformWorkWithCell(state, row, {
    baseTimeS: job.baseTimeS,
    totalEnergyE: job.totalEnergyE,
    dtS: (TICK_MS / 1000) * ctx.dt,
    remainingProgress,
    remainingEnergyE,
    gridPowered,
    tick,
    data: ctx.data,
  });
  const nextProgress = Math.min(1, job.progress + workRes.progressDelta);
  if (hasCost && workRes.progressDelta > 0) {
    const colony = ensureColony(state, order.colonyId, tick);
    const spentCost = (job.spentCost ??= {});
    payProgressiveSlice(colony, totalCost, spentCost, nextProgress, tick);
  }
  const waitsRes = hasCost && remainingProgress + 1e-6 < fullRem && nextProgress < 1 - 1e-6;
  job.status = waitsRes ? 'waiting' : 'in_progress';
  job.waitReason = waitsRes ? 'resources' : undefined;
  job.progress = nextProgress;
  job.energyDrawnE += workRes.energyDrawnE;
  if (job.progress < 1 - 1e-6) {
    setField(state.entities, row, 'progress', Math.fround(job.progress), tick);
    return false;
  }
  if (jobStillValid(state, order, job, ctx.data)) {
    completeTerraformJob(state, order.colonyId, job, ctx);
    order.completedJobs++;
    order.jobs.splice(jobIdx, 1);
  } else {
    dropJob(order, jobIdx);
  }
  setField(state.entities, row, 'progress', 0, tick);
  return true;
}

/** Whether `c`'s order still has a runnable job on tile `(c.q, c.r)` (read-only). */
function currentJob(u: UnitCtx, c: TerraformCommand): boolean {
  const order = colonyTerraformOrders(u.state, u.owner).find((o) => o.orderId === c.orderId);
  return Boolean(order && findOrderTileJobIndex(order, c.q, c.r) >= 0);
}

const reachOf = (u: UnitCtx, c: TerraformCommand) => ({ q: c.q, r: c.r, minDist: u.stats.terraformReach[0], maxDist: u.stats.terraformReach[1] });

export const terraformCommand = defineUnitCommand<TerraformCommand>({
  kind: 'terraform',
  phase: 'construction',
  key: (c) => jobKey(c.orderId, c.q, c.r),
  /** Units slot: walk into reach of the tile, then face it (the work itself happens in the construction slot). */
  execute(u, c) {
    if (!currentJob(u, c)) return 'done';
    const status = approach(u, reachOf(u, c));
    if (status !== 'arrived') return status === 'failed' ? 'failed' : 'running';
    setUnitActivity(u, ENTITY_STATE.working, c.q, c.r);
    faceTowards(u.state, u.row, c.q, c.r, u.ctx.tick);
    return 'running';
  },
  /** Construction slot: one step of work on the tile, energy from the unit's cell or Hub grid. */
  work(u, c) {
    if (!currentJob(u, c)) return 'done';
    if (!atGoal(u, reachOf(u, c))) return 'running';
    const orders = readColonyOrders(u.state, u.owner);
    const order = orders.find((o) => o.orderId === c.orderId);
    const jobIdx = order ? findOrderTileJobIndex(order, c.q, c.r) : -1;
    if (!order || jobIdx < 0) return 'done';
    order.jobs[jobIdx].assignedUnitId = u.id;
    setUnitActivity(u, ENTITY_STATE.working, c.q, c.r);
    const ended = workJob(u.state, order, jobIdx, u.row, u.ctx);
    syncOrderWaitState(order);
    writeColonyOrders(u.state, u.owner, orders, u.ctx.tick);
    if (u.state.entities.cols.kind[u.row] === ENTITY_KIND.hq) {
      syncHqView(u.state, u.row, u.ctx.tick, u.ctx.data);
    }
    return ended ? 'done' : 'running';
  },
});

/** The job a unit should do next in `order`: nearest unclaimed tile first (list order breaks ties), one job per tile. */
function nearestJob(u: UnitCtx, order: TerraformOrder, claimedTiles: ReadonlySet<string>): number {
  const cols = u.state.entities.cols;
  const seen = new Set<string>();
  let best = -1;
  let bestD = Infinity;
  order.jobs.forEach((job, i) => {
    const tile = `${job.q},${job.r}`;
    if (seen.has(tile)) return; // a tile's later job (Grade after Clear) waits for its first
    seen.add(tile);
    const key = jobKey(order.orderId, job.q, job.r);
    if (claimedTiles.has(key) || (u.record.skip[key] ?? 0) > u.ctx.tick) return;
    if (!isWorkerEligibleForJob(cols.kind[u.row], cols.tier[u.row] || 1, { kind: order.isLinkedPrep ? 'linkedPrep' : 'terraform', op: job.op })) return;
    const d = hexDistance(cols.q[u.row], cols.r[u.row], job.q, job.r);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Picks the next valid unclaimed job of `order` (dropping jobs that no longer apply). */
function pickJob(
  u: UnitCtx,
  order: TerraformOrder,
  claimedTiles: ReadonlySet<string>,
  activeWorkersOnOrder: number,
): { at: number; dropped: number } {
  let dropped = 0;
  for (;;) {
    const at = nearestJob(u, order, claimedTiles);
    if (at < 0) return { at, dropped };
    if (jobStillValid(u.state, order, order.jobs[at], u.ctx.data)) {
      if (at > 0 && activeWorkersOnOrder === 0) {
        const [job] = order.jobs.splice(at, 1);
        order.jobs.unshift(job);
        return { at: 0, dropped };
      }
      return { at, dropped };
    }
    dropJob(order, at);
    dropped++;
  }
}

function maxWorkersPerOrder(data: StepContext['data']): number {
  const cfg = (data?.tables?.terraform as Record<string, { maxAreaWorkers?: number }> | undefined)?.terraformConfig;
  return Math.max(1, Number(cfg?.maxAreaWorkers ?? 8));
}

function claimedTerraformState(u: UnitCtx): { claimedTiles: Set<string>; workersPerOrder: Map<string, number> } {
  const claimedTiles = new Set<string>();
  const workersPerOrder = new Map<string, number>();
  const byId = (
    u.state.blobs.units?.value as {
      byId?: Record<string, { current?: { kind?: string; orderId?: string; q?: number; r?: number } | null }>;
    } | undefined
  )?.byId;
  if (!byId) return { claimedTiles, workersPerOrder };
  const cols = u.state.entities.cols;
  for (const [idStr, rec] of Object.entries(byId)) {
    const otherId = Number(idStr);
    const cur = rec?.current;
    if (otherId === u.id || cur?.kind !== 'terraform' || !cur.orderId) continue;
    const r = rowOf(u.state.entities, otherId);
    if (r >= 0 && cols.owner[r] === u.owner && cols.hp[r] > 0) {
      workersPerOrder.set(cur.orderId, (workersPerOrder.get(cur.orderId) ?? 0) + 1);
      if (typeof cur.q === 'number' && typeof cur.r === 'number') {
        claimedTiles.add(jobKey(cur.orderId, cur.q, cur.r));
      }
    }
  }
  return { claimedTiles, workersPerOrder };
}

/**
 * A terraform work provider over the colony's orders that `lane` accepts. Two of them sit around the build provider
 * (GP-04): a Hub's linked prep first, then construction, then manual terraform orders.
 */
function terraformProviderFor(id: string, lane: (o: TerraformOrder) => boolean): UnitWorkProvider {
  return {
    id,
    propose(u) {
      const view = colonyTerraformOrders(u.state, u.owner).filter(lane);
      const cur = u.record.current;
      const maxWorkers = maxWorkersPerOrder(u.ctx.data);
      const { claimedTiles, workersPerOrder } = claimedTerraformState(u);
      const hasUnstaffedOrder = view.some((o) => (workersPerOrder.get(o.orderId) ?? 0) === 0 && o.jobs.length > 0);
      if (cur?.kind === 'terraform') {
        const curKey = jobKey(cur.orderId, cur.q, cur.r);
        const curWorkers = workersPerOrder.get(cur.orderId) ?? 0;
        const curOrder = view.find((o) => o.orderId === cur.orderId);
        const jobIdx = curOrder ? findOrderTileJobIndex(curOrder, cur.q, cur.r) : -1;
        const skipped = (u.record.skip[curKey] ?? 0) > u.ctx.tick;
        if (
          jobIdx >= 0 &&
          !skipped &&
          !claimedTiles.has(curKey) &&
          curWorkers < maxWorkers &&
          (curWorkers === 0 || !hasUnstaffedOrder || u.state.entities.cols.state[u.row] === ENTITY_STATE.working)
        ) {
          return cur;
        }
      }
      if (view.length === 0) return null;
      const orders = readColonyOrders(u.state, u.owner);
      let dirty = false;
      for (const preferUnstaffed of [true, false]) {
        for (const order of orders) {
          const activeCount = workersPerOrder.get(order.orderId) ?? 0;
          if (!lane(order) || activeCount >= maxWorkers) continue;
          if (preferUnstaffed ? activeCount > 0 : activeCount === 0) continue;
          const { at, dropped } = pickJob(u, order, claimedTiles, activeCount);
          dirty ||= dropped > 0 || (at > 0 && activeCount === 0);
          if (at < 0) continue;
          if (dirty) writeColonyOrders(u.state, u.owner, orders, u.ctx.tick);
          const job = order.jobs[at];
          return { kind: 'terraform', source: 'auto', orderId: order.orderId, q: job.q, r: job.r };
        }
      }
      if (dirty) writeColonyOrders(u.state, u.owner, orders, u.ctx.tick);
      return null;
    },
  };
}

const anyLinkedPrep = terraformProviderFor('terraformPrep', (o) => o.isLinkedPrep);

/**
 * A building's linked site prep (asked before construction: a site is prepared before it is built on).
 * The HQ and any Worker Drone whose tier covers the site take it (`UO-D-03`).
 */
export const linkedPrepProvider: UnitWorkProvider = {
  id: anyLinkedPrep.id,
  propose: (u) => (canDoWork(u, 'linkedPrep') ? anyLinkedPrep.propose(u) : null),
};

const anyManualTerraform = terraformProviderFor('terraform', (o) => !o.isLinkedPrep);

/** The player's manual terraform orders (asked after construction, GP-04; HQ and Worker Drone). */
export const terraformProvider: UnitWorkProvider = {
  id: anyManualTerraform.id,
  propose: (u) => (canDoWork(u, 'terraform') ? anyManualTerraform.propose(u) : null),
};
