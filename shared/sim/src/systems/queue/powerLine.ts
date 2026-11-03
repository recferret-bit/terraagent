import type { ResourceKey } from '@terra/contracts';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance, hexRound } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import type { BuildingJobRecord, BuildJobWait } from '../economy/buildJob';
import { cancelBuildingConstruction, resolveBuildingRow, startBuildingConstruction } from '../economy/construction';
import { buildingFootprints } from '../construction/occupancy';
import { hexIndex } from '../../grid/hex';
import type { QueueEntry } from './types';

export interface PlacePowerLineCommandArgs {
  tiles?: Array<{ q: number; r: number }>;
  anchors?: Array<{ q: number; r: number }>;
  from?: { q: number; r: number };
  to?: { q: number; r: number };
  tier?: number;
  taskId?: string;
}

export function resolvePylonSpan(data?: CompiledDataLike): number {
  const res = resolveBuildingRow('pylon', data);
  return Math.max(1, Number(res?.row.span ?? 6));
}

export function resolvePowerLineTiles(
  state: PlanetState,
  args: PlacePowerLineCommandArgs,
  data?: CompiledDataLike,
): Array<{ q: number; r: number }> | null {
  const span = resolvePylonSpan(data);
  const explicit = args.tiles ?? args.anchors;
  if (Array.isArray(explicit)) {
    if (explicit.length === 0) return null;
    const out: Array<{ q: number; r: number }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < explicit.length; i++) {
      const pt = explicit[i];
      if (!pt || !Number.isInteger(pt.q) || !Number.isInteger(pt.r)) return null;
      const key = `${pt.q},${pt.r}`;
      if (seen.has(key)) return null;
      seen.add(key);
      if (i > 0) {
        const prev = out[i - 1];
        if (hexDistance(prev.q, prev.r, pt.q, pt.r) > span) return null;
      }
      out.push({ q: pt.q, r: pt.r });
    }
    return out;
  }

  if (args.from && args.to && Number.isInteger(args.from.q) && Number.isInteger(args.from.r) && Number.isInteger(args.to.q) && Number.isInteger(args.to.r)) {
    const dist = hexDistance(args.from.q, args.from.r, args.to.q, args.to.r);
    if (dist === 0) return [{ q: args.from.q, r: args.from.r }];
    const hops = Math.max(1, Math.ceil(dist / span));
    const hx = hexIndex(state.grid.radius);
    const occupied = new Set<number>();
    for (const fp of buildingFootprints(state, data)) {
      for (const idx of fp) occupied.add(idx);
    }
    const fromIdx = hx.indexOf(args.from.q, args.from.r);
    const startHop = fromIdx >= 0 && occupied.has(fromIdx) ? 1 : 0;
    const out: Array<{ q: number; r: number }> = [];
    const seen = new Set<string>();
    for (let s = startHop; s <= hops; s++) {
      const t = s / hops;
      const [q, r] = hexRound(args.from.q + (args.to.q - args.from.q) * t, args.from.r + (args.to.r - args.from.r) * t);
      const key = `${q},${r}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ q, r });
      }
    }
    return out.length > 0 ? out : null;
  }

  return null;
}

export function startPowerLineConstruction(
  state: PlanetState,
  entry: QueueEntry,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): { ok: true } | { ok: false; code: string; detail?: string } {
  if (entry.task.kind !== 'powerLine') return { ok: true };
  const tiles = entry.task.tiles;
  if (!tiles || tiles.length === 0) return { ok: false, code: 'invalid_args', detail: 'empty power line' };

  const startedIds: number[] = [];
  for (const tile of tiles) {
    const started = startBuildingConstruction(
      state,
      {
        owner: entry.colonyIndex,
        building: 'pylon',
        q: tile.q,
        r: tile.r,
        rot: 0,
        workRate: entry.workRate,
        tick,
        data,
      },
      ctx,
    );
    if (!started.ok) {
      for (const id of startedIds) {
        cancelBuildingConstruction(state, id, entry.colonyIndex, tick, data);
      }
      return { ok: false, code: started.code, detail: started.detail };
    }
    startedIds.push(started.entityId);
  }

  entry.subEntityIds = startedIds;
  entry.task.subEntityIds = [...startedIds];
  entry.entityId = startedIds[0];
  return { ok: true };
}

export function followPowerLineEntry(
  state: PlanetState,
  entry: QueueEntry,
  waitDetailFn: (state: PlanetState, job: BuildingJobRecord, reason: BuildJobWait) => string,
): void {
  const subIds = entry.subEntityIds ?? (entry.task.kind === 'powerLine' ? entry.task.subEntityIds : undefined) ?? [];
  if (subIds.length === 0) return;

  const jobs = (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs ?? {};
  const totalCost = entry.totalCost ?? entry.cost;
  const count = subIds.length;
  const aggSpent: Partial<Record<ResourceKey, number>> = {};
  let progressSum = 0;
  let allDone = true;
  let firstWaitReason: BuildJobWait | undefined;
  let firstWaitJob: BuildingJobRecord | undefined;

  for (const subId of subIds) {
    const eRow = rowOf(state.entities, subId);
    const job = jobs[subId];
    const isFinished =
      eRow < 0 ||
      state.entities.cols.state[eRow] !== ENTITY_STATE.constructing ||
      state.entities.cols.progress[eRow] >= 1;

    if (isFinished) {
      progressSum += 1;
      for (const [k, v] of Object.entries(totalCost) as [ResourceKey, number][]) {
        if (v && v > 0) aggSpent[k] = Number(((aggSpent[k] ?? 0) + v / count).toFixed(6));
      }
    } else {
      allDone = false;
      progressSum += state.entities.cols.progress[eRow];
      if (job?.spentCost) {
        for (const [k, v] of Object.entries(job.spentCost) as [ResourceKey, number][]) {
          if (v && v > 0) aggSpent[k] = Number(((aggSpent[k] ?? 0) + v).toFixed(6));
        }
      }
      if (!firstWaitReason && job?.status === 'waiting') {
        firstWaitReason = job.waitReason ?? 'resources';
        firstWaitJob = job;
      }
    }
  }

  entry.spentCost = aggSpent;
  entry.paid = Object.values(aggSpent).some((v) => (v ?? 0) > 0);
  if (allDone) {
    entry.spentCost = { ...totalCost };
    entry.paid = true;
    entry.progress = 1;
    entry.state = 'done';
    entry.waitReason = undefined;
    entry.waitDetail = undefined;
    return;
  }

  entry.progress = Math.min(1, Number((progressSum / count).toFixed(4)));
  entry.waitReason = firstWaitReason;
  entry.waitDetail = firstWaitReason && firstWaitJob ? waitDetailFn(state, firstWaitJob, firstWaitReason) : undefined;
}
