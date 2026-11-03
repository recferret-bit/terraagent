import type { RejectCode } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { isTileUneven } from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { SimState } from '../../kernel/state';
import type { PlacementEntity, PlacementWorld } from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';
import { resolveStartingKitRow, rowNum } from '../rows';
import { getTerraformOpSpec, isTerraformOpKind, opForTerrain, type TerraformOpKind } from './ops';

/**
 * Terraform rules, one pure function for every caller (GP-32, like `evaluatePlacement` for buildings, D-37): the
 * `enqueueTask` handler, the job re-check before work and yield (GP-01) and the client brush preview. Callers adapt
 * their data into a read-only {@link TerraformWorld}; nothing here touches `SimState`.
 *
 * A colony may terraform its own tiles. Before it owns any (no Hub yet) it may terraform unclaimed tiles within
 * `hq.startingKit.preHubTerraformRadius` of its landing pod (GP-03); a Hub's linked prep (`allowUnclaimed`) may use any
 * unclaimed tile (`UO-TF-05`). Foreign tiles never.
 */

/** The map and the colony's standing as the terraform rule sees them. */
export interface TerraformWorld {
  radius: number;
  tileCount: number;
  terrain: ArrayLike<number>;
  prep: ArrayLike<number>;
  owner: ArrayLike<number>;
  height?: ArrayLike<number> | null;
  valid?: ArrayLike<number> | null;
  /** The colony owns territory (a tile, or an active Hub): from then on only its own tiles. */
  hasTerritory: boolean;
  /** Before territory: unclaimed tiles must lie within `preHubRadius` of this point (the colony's pod); none = no limit. */
  preHubCenter: { q: number; r: number } | null;
  preHubRadius: number;
}

export type TerraformCheck = { ok: true } | { ok: false; reason: RejectCode };

const isAlive = (e: PlacementEntity): boolean => !(e.hpMax > 0 && e.hp <= 0);

/** Whether `colonyId` owns territory: an active own Hub, or at least one own tile. */
export function worldHasTerritory(world: Pick<PlacementWorld, 'owner' | 'tileCount' | 'entities'>, colonyId: number): boolean {
  if (world.entities.some((e) => e.kind === ENTITY_KIND.hub && e.owner === colonyId && isAlive(e) && e.state === ENTITY_STATE.active)) return true;
  for (let i = 0; i < world.tileCount; i++) if (world.owner[i] === colonyId) return true;
  return false;
}

/** The terraform view of a placement world (the client ghost's world works too) for `colonyId`. */
export function terraformWorldFrom(world: PlacementWorld, colonyId: number, data?: CompiledDataLike): TerraformWorld {
  const pod = world.entities.find((e) => e.kind === ENTITY_KIND.pod && e.owner === colonyId);
  return {
    radius: world.radius,
    tileCount: world.tileCount,
    terrain: world.terrain,
    prep: world.prep,
    owner: world.owner,
    height: world.height ?? null,
    valid: world.valid ?? null,
    hasTerritory: worldHasTerritory(world, colonyId),
    preHubCenter: pod ? { q: pod.q, r: pod.r } : null,
    preHubRadius: rowNum(resolveStartingKitRow(data), 'preHubTerraformRadius'),
  };
}

/** The terraform world of authoritative state (server / browser-local host). */
export function terraformWorldFromState(state: SimState, colonyId: number, data?: CompiledDataLike): TerraformWorld {
  return terraformWorldFrom(placementWorldFromState(state), colonyId, data);
}

function tileIndex(world: TerraformWorld, q: number, r: number): number {
  if (!Number.isInteger(q) || !Number.isInteger(r)) return -1;
  const i = hexIndex(world.radius).indexOf(q, r);
  return i >= 0 && i < world.tileCount && (!world.valid || world.valid[i] !== 0) ? i : -1;
}

function ownershipBlock(world: TerraformWorld, colonyId: number, i: number, q: number, r: number, allowUnclaimed: boolean): RejectCode | null {
  const owner = world.owner[i];
  if (owner >= 0) return owner === colonyId ? null : 'not_own_territory';
  if (allowUnclaimed) return null;
  if (world.hasTerritory) return 'not_own_territory';
  const c = world.preHubCenter;
  return c && hexDistance(c.q, c.r, q, r) > world.preHubRadius ? 'not_own_territory' : null;
}

/** The territory part of the rule alone (own tiles; before territory unclaimed ones near the pod; never foreign). */
export function terraformOwnershipBlock(world: TerraformWorld, colonyId: number, i: number, q: number, r: number): RejectCode | null {
  return ownershipBlock(world, colonyId, i, q, r, false);
}

/** Whether `op` changes tile `i` (its `fromTerrain`; a terrain-keeping op such as Grade also needs the prep to change). */
function groundBlock(world: TerraformWorld, op: TerraformOpKind, i: number, data?: CompiledDataLike): RejectCode | null {
  const spec = getTerraformOpSpec(op, data);
  const terrain = world.terrain[i], prep = world.prep[i];
  if (terrain !== spec.fromTerrain) return 'site_blocked';
  if (spec.toTerrain !== spec.fromTerrain) return null;
  if (isTileUneven(world.radius, i, world.terrain, world.height)) return 'site_blocked';
  return prep === spec.toPrep || prep === PREP.living || prep === PREP.ridge || prep === PREP.moat ? 'site_blocked' : null;
}

/** Whether `colonyId` may run `op` on tile `(q, r)` now (`UO-TF-05`, §4.5). */
export function evaluateTerraformTile(
  world: TerraformWorld,
  colonyId: number,
  op: TerraformOpKind,
  q: number,
  r: number,
  opts: { allowUnclaimed?: boolean; data?: CompiledDataLike } = {},
): TerraformCheck {
  if (!isTerraformOpKind(op)) return { ok: false, reason: 'invalid_args' };
  const i = tileIndex(world, q, r);
  if (i < 0) return { ok: false, reason: 'invalid_args' };
  const reason = ownershipBlock(world, colonyId, i, q, r, Boolean(opts.allowUnclaimed)) ?? groundBlock(world, op, i, opts.data);
  return reason ? { ok: false, reason } : { ok: true };
}

/**
 * Whether an `enqueueTask` terraform stroke auto-prepares (each tile gets the op its terrain needs): a multi-tile Grade
 * stroke prepares whatever it covers. The handler and the client's brush preview both use this rule.
 */
export function enqueueAutoPrepares(op: TerraformOpKind, tileCount: number): boolean {
  return op === 'grade' && tileCount > 1;
}

/** The op a tile needs (by its terrain: forest → Clear, rock → Break, flat → Grade) if `colonyId` may run it now. */
export function resolveTerraformTileOp(
  world: TerraformWorld,
  colonyId: number,
  q: number,
  r: number,
  opts: { allowUnclaimed?: boolean; data?: CompiledDataLike } = {},
): { ok: true; op: TerraformOpKind } | { ok: false; reason: RejectCode } {
  const i = tileIndex(world, q, r);
  if (i < 0) return { ok: false, reason: 'invalid_args' };
  const op = opForTerrain(world.terrain[i], opts.data);
  if (!op) return { ok: false, reason: 'site_blocked' };
  const check = evaluateTerraformTile(world, colonyId, op, q, r, opts);
  return check.ok ? { ok: true, op } : check;
}

export interface EvaluateTerraformOpts {
  colonyId: number;
  op: TerraformOpKind;
  tiles: ReadonlyArray<{ q: number; r: number }>;
  /** Each tile gets the op its terrain needs instead of `op` (a multi-tile Grade brush stroke). */
  auto?: boolean;
  allowUnclaimed?: boolean;
  /** Jobs the colony already has queued (`jobKey`): such a tile is skipped, it is never worked twice (GP-01). */
  pending?: ReadonlySet<string>;
  data?: CompiledDataLike;
}

export interface TerraformPlan {
  jobs: Array<{ q: number; r: number; op: TerraformOpKind }>;
  skipped: Array<{ q: number; r: number; reason: RejectCode }>;
  /** The reason of the first skipped tile (what a request with no valid tile is rejected with). */
  firstReject?: RejectCode;
}

/** `op:q,r`: one job of one op on one tile. */
export const terraformJobKey = (op: string, q: number, r: number): string => `${op}:${q},${r}`;

/**
 * Plans a terraform request: one job per valid tile, each `(op, q, r)` once (duplicates in the request and jobs
 * already queued are skipped), invalid tiles skipped with their reason.
 */
export function evaluateTerraform(world: TerraformWorld, opts: EvaluateTerraformOpts): TerraformPlan {
  const plan: TerraformPlan = { jobs: [], skipped: [] };
  const seen = new Set<string>(opts.pending ?? []);
  const skip = (q: number, r: number, reason: RejectCode): void => {
    plan.skipped.push({ q, r, reason });
    plan.firstReject ??= reason;
  };
  const tileOpts = { allowUnclaimed: opts.allowUnclaimed, data: opts.data };
  for (const { q, r } of opts.tiles) {
    const res = opts.auto
      ? resolveTerraformTileOp(world, opts.colonyId, q, r, tileOpts)
      : (() => {
          const c = evaluateTerraformTile(world, opts.colonyId, opts.op, q, r, tileOpts);
          return c.ok ? { ok: true as const, op: opts.op } : c;
        })();
    if (!res.ok) {
      skip(q, r, res.reason);
      continue;
    }
    const key = terraformJobKey(res.op, q, r);
    if (seen.has(key)) {
      skip(q, r, 'site_blocked');
      continue;
    }
    seen.add(key);
    plan.jobs.push({ q, r, op: res.op });
  }
  return plan;
}
