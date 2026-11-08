import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { touchTile, type PlanetState } from '../../kernel/state';
import { cancelMove, getMotion } from '../../units/movement/orchestrator';
import { readConstructionOrders, writeConstructionOrders } from '../construction/orders';
import { getBuildingJobs, saveBuildingJobs } from '../economy/buildJob';
import { refreshHqRespawnTargets } from '../landing/hqRespawn';
import { recomputeAllColonyPower } from '../power-core';
import { removeTerraformOrder } from '../terraform-basic/queue';
import { cancelWorkJobs, getWorkJobsMap } from '../terraform-basic/workJobs';
import {
  destroyHazardEntity,
  footprintTilesOfEntity,
  getWeatherState,
  inBounds,
  resolveDefaultHazardTile,
  resolveHazardTargetTile,
  saveWeatherState,
  type WeatherBlobState,
} from './types';

export const DEFAULT_BLAST_COUNT = 37;
export const METEOR_CRATER_RADIUS = 3;

export interface MeteorCommandArgs {
  q?: number;
  r?: number;
  hexCount?: number;
  colonyIndex?: number;
}

export type MeteorImpactResult =
  | {
      ok: true;
      q: number;
      r: number;
      tiles: Array<{ q: number; r: number }>;
      destroyedEntityIds: number[];
    }
  | {
      ok: false;
      code: 'out_of_bounds' | 'invalid_args';
      detail?: string;
    };

/**
 * Collects `targetCount` (default 37, full radius-3 crater disc) in-bounds hexes around `(q, r)` in
 * increasing distance order `(dist, dq, dr)`:
 * 1. Center `(q, r)` (1 hex)
 * 2. Ring-1 neighbors in `HEX_DIRS` order (6 hexes, total 7)
 * 3. Ring-2 and Ring-3 hexes in deterministic `(ring, dq, dr)` order (up to 37 hexes total).
 */
export function collectMeteorBlastTiles(
  radius: number,
  q: number,
  r: number,
  targetCount = DEFAULT_BLAST_COUNT,
): Array<{ q: number; r: number }> {
  const count = Math.max(1, Math.min(DEFAULT_BLAST_COUNT, Math.trunc(targetCount)));
  const candidates: Array<{ q: number; r: number }> = [{ q, r }];

  for (const [dq, dr] of HEX_DIRS) {
    candidates.push({ q: q + dq, r: r + dr });
  }

  for (let ring = 2; ring <= 3; ring++) {
    for (let dq = -ring; dq <= ring; dq++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (hexDistance(0, 0, dq, dr) === ring) {
          candidates.push({ q: q + dq, r: r + dr });
        }
      }
    }
  }

  const seen = new Set<string>();
  const out: Array<{ q: number; r: number }> = [];
  for (const c of candidates) {
    if (out.length >= count) break;
    if (!inBounds(radius, c.q, c.r)) continue;
    const key = `${c.q},${c.r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function applyMeteorBlastToGrid(
  state: PlanetState,
  weather: WeatherBlobState,
  q: number,
  r: number,
  tiles: Array<{ q: number; r: number }>,
  destroyedEntityIds: number[],
  tick: number,
): void {
  const hx = hexIndex(state.grid.radius);
  const L = state.grid.layers;
  const depositTier = (L as { depositTier?: Uint8Array }).depositTier;
  for (const t of tiles) {
    const idx = hx.indexOf(t.q, t.r);
    if (idx < 0) continue;
    L.terrain[idx] = TERRAIN.hole;
    L.prep[idx] = PREP.wild;
    if (L.deposit) L.deposit[idx] = DEPOSIT.none;
    if (depositTier) depositTier[idx] = 0;
    if (L.richness) L.richness[idx] = 0;
    if (L.height) {
      const h = L.height[idx] ?? 0;
      L.height[idx] = Math.fround(Math.max(-0.35, Math.min(h - 0.3, -0.28)));
    }
    touchTile(state, idx, tick);
  }
  bumpPathEpoch(state.meta);

  const blastKeys = new Set(tiles.map((t) => `${t.q},${t.r}`));
  const nextId = typeof weather.nextCraterId === 'number' && weather.nextCraterId >= 1 ? weather.nextCraterId : 1;
  weather.nextCraterId = nextId + 1;
  const existing = (weather.craters ?? []).filter(
    (c) => !(c.q === q && c.r === r) && !c.tiles.some((t) => blastKeys.has(`${t.q},${t.r}`)),
  );
  weather.craters = [
    ...existing,
    {
      id: nextId,
      q,
      r,
      tiles: tiles.map((t) => ({ q: t.q, r: t.r })),
      tick,
    },
  ];
  weather.lastMeteor = {
    q,
    r,
    tick,
    tiles,
    destroyedEntityIds,
  };
  saveWeatherState(state, weather, tick);
  refreshHqRespawnTargets(state, tick);
}

function cleanupCraterOrdersAndUnits(
  state: PlanetState,
  blastKeys: ReadonlySet<string>,
  tick: number,
  data?: CompiledDataLike,
): void {
  const jobs = getBuildingJobs(state);
  let jobsChanged = false;
  for (const [idStr, job] of Object.entries(jobs)) {
    if (blastKeys.has(`${job.q},${job.r}`)) {
      if (job.prepOrderId) removeTerraformOrder(state, job.owner, job.prepOrderId, tick, data);
      delete jobs[Number(idStr)];
      jobsChanged = true;
    }
  }
  if (jobsChanged) saveBuildingJobs(state, jobs, tick);

  const orders = readConstructionOrders(state);
  const hitOrders = orders.filter((o) => blastKeys.has(`${o.q},${o.r}`));
  if (hitOrders.length > 0) {
    for (const o of hitOrders) {
      if (o.linkedPrepOrderId) removeTerraformOrder(state, o.colonyId, o.linkedPrepOrderId, tick, data);
    }
    writeConstructionOrders(
      state,
      orders.filter((o) => !blastKeys.has(`${o.q},${o.r}`)),
      tick,
    );
  }

  for (const wJob of Object.values(getWorkJobsMap(state))) {
    if (blastKeys.has(`${wJob.q},${wJob.r}`)) {
      cancelWorkJobs(state, wJob.colonyId, { jobId: wJob.jobId }, tick);
    }
  }

  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    const id = cols.id[row];
    if (
      blastKeys.has(`${cols.targetQ[row]},${cols.targetR[row]}`) ||
      cols.state[row] === ENTITY_STATE.moving ||
      getMotion(state, id) !== null
    ) {
      cancelMove(state, id, tick);
    }
  }
}

/** Triggers a 37-hex (radius-3 disc) meteor impact at `(q, r)`, destroying all overlapping entities and leaving `TERRAIN.hole` craters. */
export function triggerMeteorImpact(
  state: PlanetState,
  args: MeteorCommandArgs = {},
  ctx?: Partial<Pick<StepContext, 'tick' | 'data' | 'emit'>>,
): MeteorImpactResult {
  const tick = ctx?.tick ?? state.meta.tick;
  const colIdx = typeof args.colonyIndex === 'number' && args.colonyIndex >= 0 ? args.colonyIndex : 0;
  const resolved = resolveHazardTargetTile(state, args, 'Meteor', () =>
    resolveDefaultHazardTile(state, colIdx, 4, -2),
  );
  if (!resolved.ok) return resolved;
  const { q, r } = resolved;

  const targetCount =
    args.hexCount === undefined || args.hexCount === 10
      ? DEFAULT_BLAST_COUNT
      : Math.max(args.hexCount, DEFAULT_BLAST_COUNT);
  const tiles = collectMeteorBlastTiles(state.grid.radius, q, r, targetCount);
  const blastKeys = new Set(tiles.map((t) => `${t.q},${t.r}`));

  // Find every entity (buildings, units, and landed pods; skip only actively descending pods) whose tile or footprint overlaps the radius-3 blast zone
  const e = state.entities, cols = e.cols;
  const toDestroy: number[] = [];
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] === ENTITY_KIND.pod && cols.state[row] === ENTITY_STATE.descending) continue;
    const fp = footprintTilesOfEntity(state, row);
    if (
      fp.some((t) => blastKeys.has(`${t.q},${t.r}`) || hexDistance(q, r, t.q, t.r) <= METEOR_CRATER_RADIUS) ||
      hexDistance(q, r, cols.q[row], cols.r[row]) <= METEOR_CRATER_RADIUS
    ) {
      toDestroy.push(cols.id[row]);
    }
  }

  const weather = getWeatherState(state);
  const destroyedEntityIds: number[] = [];
  for (const id of toDestroy) {
    delete weather.overloadUntilByEntity[id];
    if (destroyHazardEntity(state, id, tick, ctx?.data)) {
      destroyedEntityIds.push(id);
    }
  }

  applyMeteorBlastToGrid(state, weather, q, r, tiles, destroyedEntityIds, tick);
  cleanupCraterOrdersAndUnits(state, blastKeys, tick, ctx?.data);
  recomputeAllColonyPower(state, ctx?.data, tick);

  const colId = state.colonies[colIdx]?.id;
  ctx?.emit?.({
    kind: 'meteorImpact',
    severity: 'warn',
    colonyIds: [colIdx],
    data: {
      planetId: state.meta.planetId,
      ...(colId ? { colonyId: colId } : {}),
      q,
      r,
      radius: 3,
      hexCount: tiles.length,
      tiles,
      destroyedEntityIds,
    },
  });

  return { ok: true, q, r, tiles, destroyedEntityIds };
}

export const applyDevMeteor = triggerMeteorImpact;

export const devMeteorHandler = defineCommandHandler({
  kind: 'dev.meteor',
  wave: 'W05',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as MeteorCommandArgs;
    const colonyIndex = args.colonyIndex ?? (typeof cmd.colonyIndex === 'number' ? cmd.colonyIndex : 0);
    const res = triggerMeteorImpact(state, { ...args, colonyIndex }, ctx);
    if (!res.ok) return { code: res.code, ...(res.detail ? { detail: res.detail } : {}) };
  },
});
