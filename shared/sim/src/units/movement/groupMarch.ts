import { rowOf } from '../../ecs/store';
import { fieldSeeds } from '../../grid/flowField';
import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { cancelPathRequest, enqueuePathRequest, getPathQueue } from '../../grid/pathQueue';
import { pathBlockersFor, type PathProfileId } from '../../grid/pathProfiles';
import { diskPath, leaveCorridor } from './slots';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { mobileStats } from '../mobility';
import type { MoveGoal, MotionStatus, UnitMotion } from './orchestrator';

/**
 * A group order to one hex: each member owns the slot that keeps its place in the group.
 * Outside members share one field request and leave that corridor on a clear line to the slot.
 * Plain data in `blobs.groupMarch`, omitted from client snapshots the same way `unitMotion` is.
 * Locomotion still writes positions. This module only stores routes.
 */

interface MarchSlot {
  q: number;
  r: number;
  /** Set when the member starts inside the slot disk: the path it walks, including its start tile. */
  local?: Array<{ q: number; r: number }>;
}

interface GroupMarch {
  id: string;
  anchorQ: number;
  anchorR: number;
  pace: 'own' | 'together';
  marchSpeed?: number;
  profile: PathProfileId;
  fieldReqId: string | null;
  diskRadius: number;
  /** `meta.pathEpoch` the stored parents were built under. */
  epoch: number;
  parents: number[] | null;
  seeds: number[];
  slots: Record<string, MarchSlot>;
  reserved: number[];
}

interface GroupMarchBlob {
  nextId: number;
  marches: Record<string, GroupMarch>;
  memberOf: Record<string, string>;
}

export interface MarchCommit {
  anchorQ: number;
  anchorR: number;
  pace: 'own' | 'together';
  profile: PathProfileId;
  diskRadius: number;
  marchSpeed?: number;
  slots: Record<string, MarchSlot>;
  reserved: number[];
  outside: Array<{ q: number; r: number }>;
}

export type RouteTrim = (row: number, path: readonly { q: number; r: number }[]) => { q: number; r: number }[];

function readBlob(state: PlanetState): GroupMarchBlob {
  const raw = state.blobs.groupMarch?.value as GroupMarchBlob | undefined;
  return raw && raw.marches && raw.memberOf ? raw : { nextId: 1, marches: {}, memberOf: {} };
}

function writeBlob(state: PlanetState, value: GroupMarchBlob, tick: number): void {
  setBlob(state, 'groupMarch', value, tick);
}

export function reservedSlotTiles(state: PlanetState): Set<number> {
  const blob = readBlob(state);
  const taken = new Set<number>();
  for (const march of Object.values(blob.marches)) for (const tile of march.reserved) taken.add(tile);
  return taken;
}

export function commitMarch(state: PlanetState, plan: MarchCommit, ctx: StepContext): void {
  const blob = readBlob(state);
  const id = `gm${blob.nextId++}`;
  const fieldReqId = plan.outside.length > 0 ? `gf${id}` : null;
  const march: GroupMarch = {
    id,
    anchorQ: plan.anchorQ,
    anchorR: plan.anchorR,
    pace: plan.pace,
    ...(plan.marchSpeed !== undefined ? { marchSpeed: plan.marchSpeed } : {}),
    profile: plan.profile,
    fieldReqId,
    diskRadius: plan.diskRadius,
    epoch: state.meta.pathEpoch ?? 0,
    parents: null,
    seeds: fieldSeeds(state, plan.anchorQ, plan.anchorR, plan.profile, ctx.data),
    slots: plan.slots,
    reserved: plan.reserved,
  };
  blob.marches[id] = march;
  for (const key of Object.keys(plan.slots)) blob.memberOf[key] = id;
  writeBlob(state, blob, ctx.tick);
  if (fieldReqId) {
    enqueuePathRequest(
      state,
      {
        id: fieldReqId,
        from: { q: plan.anchorQ, r: plan.anchorR },
        to: { q: plan.anchorQ, r: plan.anchorR },
        radius: state.grid.radius,
        profile: plan.profile,
        field: { anchorQ: plan.anchorQ, anchorR: plan.anchorR, targets: plan.outside },
      },
      ctx.tick,
    );
  }
}

function marchOf(blob: GroupMarchBlob, entityId: number): GroupMarch | null {
  const id = blob.memberOf[String(entityId)];
  return id ? blob.marches[id] ?? null : null;
}

function flatPath(points: readonly { q: number; r: number }[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.q, p.r);
  return out;
}

function motionFor(goal: MoveGoal, march: GroupMarch, path: number[], status: MotionStatus): UnitMotion {
  return {
    goal: { ...goal },
    reqId: status === 'pending' ? march.fieldReqId : null,
    status,
    path,
    next: 0,
    ...(march.marchSpeed !== undefined ? { marchSpeed: march.marchSpeed } : {}),
  };
}

/** When `row` is marching to this exact slot, the motion to store instead of a private A*. */
export function groupMotionFor(state: PlanetState, row: number, goal: MoveGoal): UnitMotion | null {
  if (goal.minDist !== 0 || goal.maxDist !== 0) return null;
  const blob = readBlob(state);
  const id = state.entities.cols.id[row];
  const march = marchOf(blob, id);
  const slot = march?.slots[String(id)];
  if (!march || !slot || slot.q !== goal.q || slot.r !== goal.r) return null;
  if (slot.local) {
    const here = state.entities.cols;
    const onStart = slot.local.length > 0 && here.x[row] === slot.local[0].q && here.y[row] === slot.local[0].r;
    const rest = onStart ? slot.local.slice(1) : slot.local;
    return motionFor(goal, march, flatPath(rest), rest.length > 0 ? 'following' : 'arrived');
  }
  return motionFor(goal, march, [], 'pending');
}

function walkToSeed(
  state: PlanetState,
  parents: readonly number[],
  seeds: readonly number[],
  q: number,
  r: number,
): Array<{ q: number; r: number }> | null {
  const idx = hexIndex(state.grid.radius);
  const seedSet = new Set(seeds);
  const path: Array<{ q: number; r: number }> = [];
  const seen = new Set<number>();
  let cq = q;
  let cr = r;
  for (let n = 0; n <= parents.length; n++) {
    const i = idx.indexOf(cq, cr);
    if (i < 0) return null;
    path.push({ q: cq, r: cr });
    if (seedSet.has(i)) return path;
    if (seen.has(i)) return null;
    seen.add(i);
    const back = parents[i] ?? -1;
    if (back < 0 || back > 5) return null;
    cq += HEX_DIRS[back][0];
    cr += HEX_DIRS[back][1];
  }
  return null;
}

function tileBlocked(state: PlanetState, march: GroupMarch, data: StepContext['data']): (tileIdx: number) => boolean {
  const blockers = pathBlockersFor(state, march.profile, -1, data);
  return (i) => (blockers ? blockers.goalBlocked(i) : false);
}

function pathToSlot(
  state: PlanetState,
  march: GroupMarch,
  row: number,
  slot: MarchSlot,
  data: StepContext['data'],
): Array<{ q: number; r: number }> | null {
  const cols = state.entities.cols;
  if (slot.local) {
    // Initial local routes are planning hints, not valid after the terrain or member position changes.
    const idx = hexIndex(state.grid.radius);
    const blocked = tileBlocked(state, march, data);
    if (blocked(idx.indexOf(slot.q, slot.r))) return null;
    return diskPath(idx, { q: cols.q[row], r: cols.r[row] }, slot,
      { q: march.anchorQ, r: march.anchorR }, march.diskRadius + 2, blocked);
  }
  if (!march.parents) return null;
  const walked = walkToSeed(state, march.parents, march.seeds, cols.q[row], cols.r[row]);
  if (!walked) return null;
  const idx = hexIndex(state.grid.radius);
  const blocked = tileBlocked(state, march, data);
  const peeled = leaveCorridor(walked, slot, (q, r) => {
    const tile = idx.indexOf(q, r);
    return tile >= 0 && !blocked(tile);
  });
  if (peeled) return peeled;
  const seed = walked[walked.length - 1];
  if (seed.q === slot.q && seed.r === slot.r) return walked;
  const tail = diskPath(idx, seed, slot, { q: march.anchorQ, r: march.anchorR }, march.diskRadius + 2, blocked);
  return tail ? walked.concat(tail.slice(1)) : null;
}

export function applyGroupField(
  state: PlanetState,
  motions: { byId: Record<string, UnitMotion> },
  res: { id: string | number; ok: boolean; fieldParents?: number[]; fieldSeeds?: number[] },
  ctx: StepContext,
  ended: number[],
  trim: RouteTrim,
): boolean {
  const blob = readBlob(state);
  const march = Object.values(blob.marches).find((m) => m.fieldReqId === res.id);
  if (!march) return false;
  march.fieldReqId = null;
  march.parents = res.ok ? res.fieldParents ?? null : null;
  march.seeds = res.fieldSeeds ?? march.seeds;
  march.epoch = state.meta.pathEpoch ?? 0;
  let changed = false;
  for (const key of Object.keys(march.slots)) {
    const motion = motions.byId[key];
    if (!motion || motion.reqId !== res.id) continue;
    changed = true;
    const id = Number(key);
    const row = rowOf(state.entities, id);
    const slot = march.slots[key];
    const raw = row >= 0 && march.parents && slot ? pathToSlot(state, march, row, slot, ctx.data) : null;
    motion.reqId = null;
    if (!raw) {
      motion.status = 'failed';
      ended.push(id);
      continue;
    }
    const steps = trim(row, raw);
    motion.path = flatPath(steps);
    motion.next = 0;
    motion.status = steps.length > 0 ? 'following' : 'arrived';
    if (motion.status === 'arrived') ended.push(id);
  }
  writeBlob(state, blob, ctx.tick);
  return changed;
}

function retargetField(state: PlanetState, march: GroupMarch, target: { q: number; r: number }, tick: number): void {
  if (march.fieldReqId && !march.parents) {
    const entry = getPathQueue(state).find((e) => e.id === march.fieldReqId);
    if (entry?.field && entry.expansionsUsed === 0) {
      entry.field.targets.push({ q: target.q, r: target.r });
      return;
    }
  }
  if (march.fieldReqId) cancelPathRequest(state, march.fieldReqId, tick);
  const reqId = `gf${march.id}r${tick}`;
  march.fieldReqId = reqId;
  march.parents = null;
  enqueuePathRequest(
    state,
    {
      id: reqId,
      from: { q: march.anchorQ, r: march.anchorR },
      to: { q: march.anchorQ, r: march.anchorR },
      radius: state.grid.radius,
      profile: march.profile,
      field: { anchorQ: march.anchorQ, anchorR: march.anchorR, targets: [target] },
    },
    tick,
  );
}

/** Rebuilds one member's route from the shared field, or queues one replacement field. `false` when it is not a member. */
export function replanGroupMember(
  state: PlanetState,
  motions: { byId: Record<string, UnitMotion> },
  row: number,
  ctx: StepContext,
  trim: RouteTrim,
): boolean {
  const blob = readBlob(state);
  const id = state.entities.cols.id[row];
  const march = marchOf(blob, id);
  const slot = march?.slots[String(id)];
  const motion = motions.byId[String(id)];
  if (!march || !slot || !motion) return false;
  const fresh = march.parents !== null && march.epoch === (state.meta.pathEpoch ?? 0);
  const raw = (slot.local || fresh) ? pathToSlot(state, march, row, slot, ctx.data) : null;
  if (raw) {
    const steps = trim(row, raw);
    motion.path = flatPath(steps);
    motion.next = 0;
    motion.reqId = null;
    motion.status = steps.length > 0 ? 'following' : 'arrived';
    writeBlob(state, blob, ctx.tick);
    return true;
  }
  if (slot.local) {
    motion.path = [];
    motion.status = 'failed';
    motion.reqId = null;
    writeBlob(state, blob, ctx.tick);
    return true;
  }
  const cols = state.entities.cols;
  retargetField(state, march, { q: cols.q[row], r: cols.r[row] }, ctx.tick);
  motion.path = [];
  motion.next = 0;
  motion.reqId = march.fieldReqId;
  motion.status = 'pending';
  writeBlob(state, blob, ctx.tick);
  return true;
}

/** Drops `entityId` from its march. Cancels the shared field once nobody remains. */
export function detachMember(state: PlanetState, entityId: number, tick: number): void {
  const blob = readBlob(state);
  const key = String(entityId);
  const marchId = blob.memberOf[key];
  if (!marchId) return;
  const march = blob.marches[marchId];
  delete blob.memberOf[key];
  if (!march) {
    writeBlob(state, blob, tick);
    return;
  }
  const idx = hexIndex(state.grid.radius);
  const slot = march.slots[key];
  if (slot) {
    const tile = idx.indexOf(slot.q, slot.r);
    march.reserved = march.reserved.filter((t) => t !== tile);
    delete march.slots[key];
  }
  if (Object.keys(march.slots).length === 0) {
    if (march.fieldReqId) cancelPathRequest(state, march.fieldReqId, tick);
    delete blob.marches[marchId];
  }
  writeBlob(state, blob, tick);
}

export function slowestSpeed(state: PlanetState, ids: readonly number[], data: StepContext['data']): number {
  let min = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const row = rowOf(state.entities, id);
    if (row < 0) continue;
    const speed = mobileStats(state.entities.cols.kind[row], data)?.speedPerTick ?? min;
    if (speed < min) min = speed;
  }
  return min;
}

export function slotDistance(anchor: { q: number; r: number }, slots: readonly { q: number; r: number }[]): number {
  let radius = 0;
  for (const slot of slots) radius = Math.max(radius, hexDistance(anchor.q, anchor.r, slot.q, slot.r));
  return radius;
}
