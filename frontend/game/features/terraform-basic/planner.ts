import type { RejectCode } from '@terra/contracts';
import {
  DISMANTLE_REFUND_RATE,
  ENTITY_KIND,
  entityFootprint,
  getEntityBaseBuildCost,
  getBuildingFootprintTiles,
  occupiedTiles,
  placementWorldFromState,
  planGroundWorkTiles,
  REPAIR_COST_RATE,
  terraformWorldFrom,
  type CompiledDataLike,
  type PlanetState,
  type TerraformOpKind,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { viewPlacementWorld } from '../shared/placementWorld';
import type { TileCoord } from '../shared/pointer';
import { extractColonyOrders } from './TileOverlay';
import { colonyWorkJobs } from './workStatus';

/**
 * The 3 buttons of the Terraform dock tab. TERRAFORM goes on the wire as `work` + `intent: 'terraform'` (the host picks
 * each hex's work from its ground and chains on), REPAIR as `work` + `intent: 'repair'`, DISMANTLE as `dismantle`.
 */
export type TerraformPrimaryOp = 'terraform' | 'repair' | 'dismantle';

export interface PlannedTileJob {
  q: number;
  r: number;
  op: TerraformOpKind | 'repair';
}

export interface BrushPlan {
  jobs: PlannedTileJob[];
  queuedCount: number;
  skippedCount: number;
  /** Why the first skipped hex was skipped (what a stroke with no valid hex is rejected with). */
  firstReject?: RejectCode;
}

/** `45%`, `12.5%`: a rate as a percentage. */
export const pct = (x: number): string => `${Number((x * 100).toFixed(2))}%`;

/** The sim's rates (`TERRAFORM_TIME_TABLE.repair.costRate` / `.dismantle.refundRate`). */
export const FULL_REPAIR_COST_RATIO = REPAIR_COST_RATE;
export const DISMANTLE_REFUND_RATIO = DISMANTLE_REFUND_RATE;


export interface InspectableEntity {
  id?: number;
  kind: number | string;
  kindName: string;
  owner?: number;
  q: number;
  r: number;
  hp?: number;
  hpMax?: number;
  /** `ENTITY_STATE` code when the view carries it. */
  state?: number;
  tier?: number;
  footprintW: number;
  footprintD: number;
  cost?: Readonly<Record<string, number>>;
}

export function normalizeEntityKindName(kind: unknown): string {
  if (kind === ENTITY_KIND.commandHub || kind === 'commandHub' || kind === 'hub') return 'commandHub';
  if (kind === ENTITY_KIND.hq || kind === 'hq' || kind === 'hqDrone') return 'hq';
  if (kind === ENTITY_KIND.worker || kind === 'worker') return 'worker';
  if (kind === ENTITY_KIND.metalsExtractor || kind === 'metalsExtractor' || kind === 'extractor') return 'metalsExtractor';
  if (kind === ENTITY_KIND.solar || kind === 'solar' || kind === 'solarCollector') return 'solar';
  if (kind === ENTITY_KIND.tradeHub || kind === 'tradeHub') return 'tradeHub';
  if (kind === ENTITY_KIND.pod || kind === 'pod' || kind === 'dropPod') return 'pod';
  return typeof kind === 'string' ? kind : 'entity';
}

export function resolveEntityBaseCost(
  kindName: string,
  explicitCost?: Readonly<Record<string, number>>,
  data?: CompiledDataLike,
): Record<string, number> {
  if (explicitCost && Object.keys(explicitCost).length > 0) return { ...explicitCost };
  const kind = (ENTITY_KIND as Record<string, number>)[kindName];
  if (kind === undefined) return {};
  return { ...(getEntityBaseBuildCost(kind, data) as Record<string, number>) };
}

/** Full repair (`hp = 0`) costs 40% of basic resources; partial damage scales proportionally. */
export function calculateRepairCost(
  baseCost: Readonly<Record<string, number>>,
  hp: number,
  hpMax: number,
): Record<string, number> {
  if (!(hpMax > 0) || hp >= hpMax) return {};
  const missingRatio = Math.max(0, Math.min(1, (hpMax - hp) / hpMax));
  const out: Record<string, number> = {};
  for (const [res, amt] of Object.entries(baseCost)) {
    if (amt > 0) out[res] = Number((amt * FULL_REPAIR_COST_RATIO * missingRatio).toFixed(2));
  }
  return out;
}

/** Dismantling a unit or building refunds 50% of spent resources. */
export function calculateDismantleRefund(spentCost: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [res, amt] of Object.entries(spentCost)) {
    if (amt > 0) out[res] = Number((amt * DISMANTLE_REFUND_RATIO).toFixed(2));
  }
  return out;
}

/** Footprint of a building the view row does not size: the sim's `entityFootprint` (Hub 3, 2×2 buildings, else 1). */
function defaultFootprintForKind(rawKind: number | string, kindName: string): number {
  const code = typeof rawKind === 'number' ? rawKind : (ENTITY_KIND as Record<string, number>)[kindName];
  return code === undefined ? 1 : entityFootprint(code);
}

function toInspectableEntity(raw: Record<string, unknown>): InspectableEntity | null {
  // Units stand between hex centres while they walk: the hex they are on is the rounded one (as the host finds them).
  const q = Math.round(typeof raw.q === 'number' ? raw.q : typeof raw.x === 'number' ? raw.x : NaN);
  const r = Math.round(typeof raw.r === 'number' ? raw.r : typeof raw.y === 'number' ? raw.y : NaN);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  const rawKind = (raw.kind ?? raw.building ?? raw.unit ?? 'entity') as number | string;
  const kindName = normalizeEntityKindName(rawKind);
  const defFp = defaultFootprintForKind(rawKind, kindName);
  const fw = Number(raw.footprintW ?? raw.w ?? raw.footprint ?? defFp) || defFp;
  const fd = Number(raw.footprintD ?? raw.d ?? raw.h ?? raw.footprint ?? defFp) || defFp;
  return {
    ...(typeof raw.id === 'number' ? { id: raw.id } : {}),
    kind: rawKind,
    kindName,
    ...(typeof raw.owner === 'number' ? { owner: raw.owner } : {}),
    q,
    r,
    ...(typeof raw.hp === 'number' ? { hp: raw.hp } : {}),
    ...(typeof raw.hpMax === 'number' ? { hpMax: raw.hpMax } : {}),
    ...(typeof raw.state === 'number' ? { state: raw.state } : {}),
    ...(typeof raw.tier === 'number' ? { tier: raw.tier } : {}),
    footprintW: Math.max(1, Math.trunc(fw)),
    footprintD: Math.max(1, Math.trunc(fd)),
    ...(raw.cost && typeof raw.cost === 'object' ? { cost: raw.cost as Readonly<Record<string, number>> } : {}),
  };
}

function pushInspectableItems(out: InspectableEntity[], items: readonly unknown[]): void {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const conv = toInspectableEntity(item as Record<string, unknown>);
    if (conv) out.push(conv);
  }
}

export function extractViewEntities(
  view: GameView | null | undefined,
  hostState?: PlanetState | null,
): InspectableEntity[] {
  const out: InspectableEntity[] = [];
  const v = (view ?? {}) as { entities?: unknown; units?: unknown[]; count?: number };
  if (v.entities instanceof Float32Array) {
    pushInspectableItems(out, viewPlacementWorld(view).entities);
  } else if (Array.isArray(v.entities)) {
    pushInspectableItems(out, v.entities);
  }
  if (Array.isArray(v.units)) {
    pushInspectableItems(out, v.units);
  }
  if (out.length === 0 && hostState) {
    pushInspectableItems(out, placementWorldFromState(hostState).entities);
  }
  return out;
}

function isEntityAlive(e: InspectableEntity): boolean {
  return !(typeof e.hpMax === 'number' && e.hpMax > 0 && typeof e.hp === 'number' && e.hp <= 0);
}

/**
 * Finds an alive entity of `colonyId` at `(q, r)`: one standing on the hex first, then a building whose footprint
 * covers it (centred on its anchor, the sim's `getBuildingFootprintTiles`).
 */
export function findEntityAtTile(
  entities: readonly InspectableEntity[],
  q: number,
  r: number,
  colonyId?: number,
  includePod = false,
): InspectableEntity | null {
  const candidates = entities.filter(
    (e) => (includePod || e.kindName !== 'pod') && isEntityAlive(e) && (colonyId === undefined || e.owner === colonyId),
  );
  // Several on one hex (the HQ Drone on the landed pod): the pod ranks behind units and buildings, ahead of the HQ.
  const rank = (e: InspectableEntity): number => (e.kindName === 'hq' || e.kindName === 'commandHub' ? 2 : e.kindName === 'pod' ? 1 : 0);
  const exact = candidates.filter((e) => e.q === q && e.r === r).sort((a, b) => rank(a) - rank(b))[0];
  if (exact) return exact;
  for (const e of candidates) {
    const size = Math.max(e.footprintW, e.footprintD);
    if (size > 1 && getBuildingFootprintTiles(e.q, e.r, size).some((p) => p.q === q && p.r === r)) return e;
  }
  return null;
}

/** Checks whether the player has an alive HQ Drone or Worker Drone available to perform terraform/work orders. */
export function hasWorkerEntity(
  entities: readonly InspectableEntity[],
  colonyId: number,
  view?: GameView | null,
): boolean {
  for (const e of entities) {
    if (!isEntityAlive(e)) continue;
    if (e.owner !== undefined && e.owner !== colonyId) continue;
    if (e.kindName === 'hq' || e.kindName === 'worker') return true;
  }
  const colonies = (view as { colonies?: Array<{ index?: number; hq?: { hp?: number; cell?: number } }> } | null)?.colonies;
  const col = colonies?.find((c) => c.index === colonyId) ?? colonies?.[colonyId];
  return Boolean(col?.hq && (col.hq.hp === undefined || col.hq.hp > 0));
}

/** Tiles already named by a terraform order or a `work` job (the host skips those: never worked twice). */
function pendingTiles(view: GameView | null | undefined, colonyId: number): Set<string> {
  const out = new Set<string>();
  for (const o of extractColonyOrders(view, colonyId)) for (const j of o.jobs) out.add(`${j.q},${j.r}`);
  for (const j of colonyWorkJobs(view, colonyId)) if (j.mode === 'terraform') out.add(`${j.q},${j.r}`);
  return out;
}

/**
 * Preview of a TERRAFORM stroke with the sim's own ground rule (`planGroundWorkTiles` / `evaluateGroundWorkTile`,
 * the function the `work` handler runs). One `work` job per hex the chain can take (trees, rock, slope, crater,
 * water). Level flat that is already `flat`, prepared, irrigated or living is `already_terraformed` — the button
 * does not climb into Irrigate or Seed. D-37.
 */
export function planTerraformTiles(
  view: GameView | null | undefined,
  tiles: readonly TileCoord[],
  opts: { colonyId: number; data?: CompiledDataLike },
): BrushPlan {
  const placement = viewPlacementWorld(view);
  if (placement.tileCount === 0) return { jobs: [], queuedCount: 0, skippedCount: tiles.length };
  // `viewPlacementWorld` carries the host's per-colony worker tier, so Deep Reclaim unlocks with a T2 worker (W05-06).
  const world = terraformWorldFrom(placement, opts.colonyId, opts.data);
  const plan = planGroundWorkTiles(world, tiles, {
    colonyId: opts.colonyId,
    deposit: placement.deposit,
    occupied: occupiedTiles(placement, opts.data),
    pending: pendingTiles(view, opts.colonyId),
    data: opts.data,
  });
  return {
    jobs: plan.jobs,
    queuedCount: plan.jobs.length,
    skippedCount: plan.skipped.length,
    ...(plan.firstReject ? { firstReject: plan.firstReject } : {}),
  };
}
