import type { RejectCode, ResourceKey } from '@terra/contracts';
import { TERRAFORM_TIME_TABLE, type TerraformTimeKey } from '../../data/ops-basic';
import { isTileUneven } from '../../grid/geo';
import { hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { TICK_MS } from '../../kernel/constants';
import type { CompiledDataLike } from '../../kernel/config';
import { duneWorkTiles, scaleSlopeWork } from './duneFootprint';
import { meteorCraterWorkTiles } from './meteorCraterFootprint';
import { getTerraformOpSpec, groundWorkYields, isTerraformOpCompiled } from './ops';
import { terraformOwnershipBlock, type TerraformWorld } from './rules';

/** Terrain key a `work` job carries (the time-table keys, plus water which is priced from the op spec). */
export type GroundTerrainKey = TerraformTimeKey | 'shallow' | 'deep';

/** What terraforming one ground tile by `work` takes. Water uses the `reclaim` / `deepReclaim` spec, not a second table. */
export type GroundWork = {
  terrainKey: GroundTerrainKey;
  /** Set for water: duration, energy, yield and resource cost come from this op. */
  workOp?: 'reclaim' | 'deepReclaim';
  durationTicks: number;
  energyCost: number;
  yields: Partial<Record<ResourceKey, number>>;
  totalCost: Partial<Record<ResourceKey, number>>;
};

const ticksOf = (baseTimeS: number): number => Math.max(1, Math.round((baseTimeS * 1000) / TICK_MS));

/** Meteor crater terraforming takes 10x longer than a single isolated hole tile. */
export const METEOR_CRATER_TERRAFORM_MULTIPLIER = 10;

/** Scales a ground `work` specification's duration by {@link METEOR_CRATER_TERRAFORM_MULTIPLIER} for full meteor craters. */
export function scaleMeteorCraterWork<T extends GroundWork>(work: T): T {
  return {
    ...work,
    durationTicks: work.durationTicks * METEOR_CRATER_TERRAFORM_MULTIPLIER,
  };
}

/** Forest / rock / slope / hole / wild flat: the shared time table (yields still come from the op rows). */
export function timedGroundWork(key: TerraformTimeKey, data?: CompiledDataLike): { ok: true } & GroundWork {
  const spec = TERRAFORM_TIME_TABLE[key];
  return { ok: true, terrainKey: key, durationTicks: spec.durationTicks, energyCost: spec.energyCost, yields: groundWorkYields(key, data), totalCost: {} };
}

function waterWork(op: 'reclaim' | 'deepReclaim', data?: CompiledDataLike): { ok: true } & GroundWork {
  const spec = getTerraformOpSpec(op, data);
  return {
    ok: true,
    terrainKey: op === 'reclaim' ? 'shallow' : 'deep',
    workOp: op,
    durationTicks: ticksOf(spec.baseTimeS),
    energyCost: spec.energyCostE,
    yields: { ...spec.yields },
    totalCost: { ...spec.cost },
  };
}

/** Level flat whose prep is already `flat`, prepared, irrigated or living: the TERRAFORM tool has nothing to do. */
function finishedLevelFlat(prep: number, uneven: boolean): boolean {
  return !uneven && (prep === PREP.flat || prep === PREP.prepared || prep === PREP.irrigated || prep === PREP.living);
}

/**
 * Whether `colonyId` may terraform ground tile `tileIdx` with `work`, and what it takes.
 * The territory rule, then the ground: no deposit, no building, not already level flat
 * (`flat` / `prepared` / `irrigated` / `living`). Shallow water is `reclaim` (T1). Deep water is `deepReclaim`
 * and `worker_tier_locked` until the colony has a worker of that op's tier. One function for the host and the client.
 */
export function evaluateGroundWorkTile(
  world: TerraformWorld,
  colonyId: number,
  tileIdx: number,
  q: number,
  r: number,
  opts: { deposit?: ArrayLike<number> | null; occupied?: boolean; weather?: unknown; data?: CompiledDataLike } = {},
): ({ ok: true } & GroundWork) | { ok: false; reason: RejectCode } {
  if (tileIdx < 0 || tileIdx >= world.tileCount || (world.valid && world.valid[tileIdx] === 0)) return { ok: false, reason: 'invalid_args' };
  const territory = terraformOwnershipBlock(world, colonyId, tileIdx, q, r);
  if (territory) return { ok: false, reason: territory };
  if (opts.occupied) return { ok: false, reason: 'site_blocked' };
  const deposit = opts.deposit;
  if (deposit && deposit[tileIdx] !== DEPOSIT.none) return { ok: false, reason: 'site_blocked' };

  const t = world.terrain[tileIdx];
  const data = opts.data;
  if (t === TERRAIN.forest) return timedGroundWork('forest', data);
  if (t === TERRAIN.rock) return timedGroundWork('rock', data);
  // A slope hex is a dune disc: slower than one hex, cleared together in `flattenDuneFootprint`.
  if (t === TERRAIN.slope) return scaleSlopeWork(timedGroundWork('slope', data));
  if (t === TERRAIN.hole) {
    const craterTiles = meteorCraterWorkTiles(world.radius, q, r, world.terrain, opts.weather);
    const base = timedGroundWork('hole', data);
    return craterTiles.length > 1 ? scaleMeteorCraterWork(base) : base;
  }
  if (t === TERRAIN.shallow) return isTerraformOpCompiled('reclaim', data) ? waterWork('reclaim', data) : { ok: false, reason: 'site_blocked' };
  if (t === TERRAIN.deep) {
    if (!isTerraformOpCompiled('deepReclaim', data)) return { ok: false, reason: 'site_blocked' };
    const spec = getTerraformOpSpec('deepReclaim', data);
    if (spec.minWorkerTier > (world.maxWorkerTier ?? 1)) return { ok: false, reason: 'worker_tier_locked' };
    return waterWork('deepReclaim', data);
  }
  if (t === TERRAIN.flat) {
    const uneven = isTileUneven(world.radius, tileIdx, world.terrain, world.height);
    if (finishedLevelFlat(world.prep[tileIdx] ?? 0, uneven)) return { ok: false, reason: 'already_terraformed' };
    return timedGroundWork('flat', data);
  }
  return { ok: false, reason: 'site_blocked' };
}

export interface GroundWorkPlan {
  jobs: Array<{ q: number; r: number; op: 'work' }>;
  skipped: Array<{ q: number; r: number; reason: RejectCode }>;
  firstReject?: RejectCode;
}

/**
 * Returns the full tile footprint covered by an active ground `work` job (e.g. a 5-wide dune disc for `slope`,
 * or the whole meteor crater for `hole`).
 */
export function activeWorkFootprintTiles(
  gridOrState: {
    radius?: number;
    terrain?: ArrayLike<number>;
    deposit?: ArrayLike<number> | null;
    weather?: unknown;
    grid?: { radius: number; layers: { terrain: ArrayLike<number>; deposit?: ArrayLike<number> | null } };
    blobs?: Record<string, unknown>;
  },
  job: { q: number; r: number; terrainKey?: string; targetTerrain?: string },
): Array<{ q: number; r: number }> {
  const radius = gridOrState.grid?.radius ?? gridOrState.radius ?? 0;
  const terrain = gridOrState.grid?.layers.terrain ?? gridOrState.terrain;
  const deposit = gridOrState.grid?.layers.deposit ?? gridOrState.deposit;
  const weather = gridOrState.blobs?.weather ?? gridOrState.weather;
  if (!terrain || radius <= 0) return [{ q: job.q, r: job.r }];
  const hx = hexIndex(radius);
  const idx = hx.indexOf(job.q, job.r);
  const tKey = job.terrainKey ?? job.targetTerrain;
  if (tKey === 'slope' || (idx >= 0 && terrain[idx] === TERRAIN.slope)) {
    const disc = duneWorkTiles(radius, job.q, job.r, terrain, deposit);
    return disc.length > 0 ? disc : [{ q: job.q, r: job.r }];
  }
  if (tKey === 'hole' || (idx >= 0 && terrain[idx] === TERRAIN.hole)) {
    const crater = meteorCraterWorkTiles(radius, job.q, job.r, terrain, weather);
    return crater.length > 0 ? crater : [{ q: job.q, r: job.r }];
  }
  return [{ q: job.q, r: job.r }];
}

/**
 * Plans a TERRAFORM stroke: one `work` job per tile the ground rule accepts. A locked tile (deep water, no T2 worker)
 * is skipped; the other tiles of the stroke are still jobs. A stroke whose every tile is skipped reports `firstReject`.
 */
export function planGroundWorkTiles(
  world: TerraformWorld,
  tiles: ReadonlyArray<{ q: number; r: number }>,
  opts: {
    colonyId: number;
    deposit?: ArrayLike<number> | null;
    occupied?: ReadonlySet<number>;
    pending?: ReadonlySet<string>;
    weather?: unknown;
    data?: CompiledDataLike;
  },
): GroundWorkPlan {
  const plan: GroundWorkPlan = { jobs: [], skipped: [] };
  const hx = hexIndex(world.radius);
  const seen = new Set<string>();
  const skip = (q: number, r: number, reason: RejectCode): void => {
    plan.skipped.push({ q, r, reason });
    plan.firstReject ??= reason;
  };
  for (const t of tiles) {
    const key = `${t.q},${t.r}`;
    const i = hx.indexOf(t.q, t.r);
    const craterGroup =
      i >= 0 && world.terrain[i] === TERRAIN.hole
        ? meteorCraterWorkTiles(world.radius, t.q, t.r, world.terrain, opts.weather)
        : [];
    const alreadyQueued =
      seen.has(key) ||
      Boolean(opts.pending?.has(key)) ||
      (craterGroup.length > 1 &&
        craterGroup.some((c) => {
          const ck = `${c.q},${c.r}`;
          return seen.has(ck) || Boolean(opts.pending?.has(ck));
        }));
    if (alreadyQueued) {
      skip(t.q, t.r, 'already_queued');
      continue;
    }
    const res = evaluateGroundWorkTile(world, opts.colonyId, i, t.q, t.r, {
      deposit: opts.deposit,
      occupied: i >= 0 && (opts.occupied?.has(i) ?? false),
      weather: opts.weather,
      data: opts.data,
    });
    if (!res.ok) {
      skip(t.q, t.r, res.reason);
      continue;
    }
    seen.add(key);
    if (craterGroup.length > 1) {
      for (const c of craterGroup) seen.add(`${c.q},${c.r}`);
    }
    plan.jobs.push({ q: t.q, r: t.r, op: 'work' });
  }
  return plan;
}
