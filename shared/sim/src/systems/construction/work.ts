import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { approach, atGoal, setUnitActivity } from '../../units/approach';
import { faceTowards } from '../../units/movement/locomotion';
import { defineUnitCommand, type BuildCommand, type UnitCtx, type UnitWorkProvider } from '../../units/types';
import { syncHqView } from '../hq/view';
import { advanceBuildingJob, buildJobEntityId, buildJobKey, readyBuildingJob, readyBuildingJobs } from '../economy/buildJob';
import { canDoWork } from '../dispatch/eligibility';
import { advanceConstructionProgress, type BuildStepResult } from './build';
import { constructionOrdersOf, readConstructionOrders, writeConstructionOrders } from './orders';

/**
 * Construction as unit work (`UO-L-05`, `UO-Q-01`, W02-16). What to build comes from two queues: the W01 construction
 * orders (`state.blobs.constructionQueue`, the Command Hub) and the W02 building jobs (`state.blobs.construction`,
 * `../economy/buildJob.ts`); the `build` unit command does both the same way: the builder walks (movement orchestrator)
 * to a tile within its build reach of the site, outside the footprint, then advances the site each step it stands there.
 * Payment follows the work (each queue pays its own way). The command sets the builder's state; build code only reports
 * progress (GP-16).
 */

const EN_ROUTE = 'waiting(builder: HQ en route)';

/** One site the `build` command can work: where it is, what to show while the builder walks, one step of work. */
interface BuildSite {
  q: number;
  r: number;
  /** While the builder walks: the W01 order shows `EN_ROUTE` (a W02 job's bookkeeping says `worker` by itself). */
  enRoute(u: UnitCtx): void;
  advance(u: UnitCtx): BuildStepResult;
}

const reachOf = (u: UnitCtx, site: { q: number; r: number }) => ({ q: site.q, r: site.r, minDist: u.stats.buildReach[0], maxDist: u.stats.buildReach[1] });

/** The colony's W01 order `orderId` while it is in progress, as a build site (read-only until worked). */
function orderSite(u: UnitCtx, orderId: string): BuildSite | null {
  const order = constructionOrdersOf(u.state.blobs.constructionQueue?.value, u.owner).find((o) => o.orderId === orderId);
  if (!order || order.status !== 'in_progress') return null;
  if (!canDoWork(u, 'build', order.tier || 1)) return null;
  return {
    q: order.q,
    r: order.r,
    enRoute() {
      if (order.statusText === EN_ROUTE) return;
      const orders = readConstructionOrders(u.state);
      const own = orders.find((o) => o.orderId === order.orderId);
      if (own) own.statusText = EN_ROUTE;
      writeConstructionOrders(u.state, orders, u.ctx.tick);
    },
    advance() {
      const orders = readConstructionOrders(u.state);
      const own = orders.find((o) => o.orderId === order.orderId);
      if (!own) return 'completed';
      const res = advanceConstructionProgress(u.state, own, rowOf(u.state.entities, own.entityId), u.row, u.ctx.tick, u.ctx);
      writeConstructionOrders(u.state, orders, u.ctx.tick);
      return res;
    },
  };
}

/** The colony's W02 job of building `entityId` while a builder can work it, as a build site. */
function jobSite(u: UnitCtx, entityId: number): BuildSite | null {
  const job = readyBuildingJob(u.state, u.owner, entityId);
  if (!job) return null;
  const eRow = rowOf(u.state.entities, entityId);
  const bTier = eRow >= 0 ? u.state.entities.cols.tier[eRow] || 1 : 1;
  if (!canDoWork(u, 'build', bTier)) return null;
  return { q: job.q, r: job.r, enRoute() {}, advance: () => advanceBuildingJob(u.state, entityId, u.row, u.ctx) ?? 'completed' };
}

function siteOf(u: UnitCtx, c: BuildCommand): BuildSite | null {
  const jobEntity = buildJobEntityId(c.orderId);
  return jobEntity !== null ? jobSite(u, jobEntity) : orderSite(u, c.orderId);
}

export const buildCommand = defineUnitCommand<BuildCommand>({
  kind: 'build',
  phase: 'construction',
  key: (c) => `build:${c.orderId}`,
  /** Units slot: walk to a tile within build reach of the site (outside its footprint) and face it. */
  execute(u, c) {
    const site = siteOf(u, c);
    if (!site) return 'done';
    const status = approach(u, reachOf(u, site));
    if (status !== 'arrived') {
      site.enRoute(u);
      return status === 'failed' ? 'failed' : 'running';
    }
    faceTowards(u.state, u.row, site.q, site.r, u.ctx.tick);
    return 'running';
  },
  /** Construction slot: one step of build progress (and the matching slice of the cost), only while in reach. */
  work(u, c) {
    const site = siteOf(u, c);
    if (!site) return 'done';
    if (!atGoal(u, reachOf(u, site))) return 'running';
    setUnitActivity(u, ENTITY_STATE.constructing, site.q, site.r);
    const res = site.advance(u);
    if (res !== 'running') {
      const cols = u.state.entities.cols;
      setUnitActivity(u, ENTITY_STATE.idle, cols.q[u.row], cols.r[u.row]);
    }
    if (u.state.entities.cols.kind[u.row] === ENTITY_KIND.hq) {
      syncHqView(u.state, u.row, u.ctx.tick, u.ctx.data);
    }
    return res === 'running' ? 'running' : 'done';
  },
});

function claimedBuildOrderIds(u: UnitCtx): Set<string> {
  const out = new Set<string>();
  const byId = (u.state.blobs.units?.value as { byId?: Record<string, { current?: { kind?: string; orderId?: string } | null }> } | undefined)?.byId;
  if (!byId) return out;
  const cols = u.state.entities.cols;
  for (const [idStr, rec] of Object.entries(byId)) {
    const otherId = Number(idStr);
    if (otherId === u.id || rec?.current?.kind !== 'build' || !rec.current.orderId) continue;
    const r = rowOf(u.state.entities, otherId);
    if (r >= 0 && cols.owner[r] === u.owner && cols.hp[r] > 0) {
      out.add(rec.current.orderId);
    }
  }
  return out;
}

/**
 * Dispatch of construction to builders (W02-16, W03-02, `UO-D-03`): a unit that may build (`maxBuildTier` ≥ the site's tier;
 * a Harvester never does) takes an unclaimed ready W01 order or W02/W03 job, and keeps the one it works on until it is done:
 * one site at a time per builder so HQ (1.5×) and Builder Drone (1.0×) build multiple sites in parallel.
 */
export const buildProvider: UnitWorkProvider = {
  id: 'build',
  propose(u) {
    if (!canDoWork(u, 'build')) return null;
    const cur = u.record.current;
    const ready = [
      ...constructionOrdersOf(u.state.blobs.constructionQueue?.value, u.owner).filter(
        (o) => o.status === 'in_progress' && canDoWork(u, 'build', o.tier || 1),
      ),
      ...readyBuildingJobs(u.state, u.owner)
        .filter((j) => {
          const eRow = rowOf(u.state.entities, j.entityId);
          const bTier = eRow >= 0 ? u.state.entities.cols.tier[eRow] || 1 : 1;
          return canDoWork(u, 'build', bTier);
        })
        .map((j) => ({ orderId: buildJobKey(j.entityId), q: j.q, r: j.r })),
    ];
    const skipped = (key: string) => (u.record.skip[`build:${key}`] ?? 0) > u.ctx.tick;
    const claimed = claimedBuildOrderIds(u);
    const unclaimed = ready.find((o) => !skipped(o.orderId) && !claimed.has(o.orderId));
    if (
      cur?.kind === 'build' &&
      !skipped(cur.orderId) &&
      ready.some((o) => o.orderId === cur.orderId)
    ) {
      return cur;
    }
    const next = unclaimed ?? ready.find((o) => !skipped(o.orderId));
    return next ? { kind: 'build', source: 'auto', orderId: next.orderId, q: next.q, r: next.r } : null;
  },
};
