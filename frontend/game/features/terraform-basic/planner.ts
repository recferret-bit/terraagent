import {
  DISMANTLE_REFUND_RATE,
  enqueueAutoPrepares,
  ENTITY_KIND,
  evaluateTerraform,
  getEntityBaseBuildCost,
  getBuildingFootprintTiles,
  isTerraformOpKind,
  placementWorldFromState,
  REPAIR_COST_RATE,
  terraformJobKey,
  terraformWorldFrom,
  type CompiledDataLike,
  type PlanetState,
  type TerraformOpKind,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { viewPlacementWorld } from '../shared/placementWorld';
import type { TileCoord } from '../shared/pointer';
import { extractColonyOrders } from './TileOverlay';

export type TerraformOpId = TerraformOpKind;
/** The 3 buttons of the Terraform dock tab. TERRAFORM and REPAIR both go on the wire as `op: 'work'` + an `intent`. */
export type TerraformPrimaryOp = 'terraform' | 'repair' | 'dismantle';
export type TerraformButtonOp = TerraformPrimaryOp | TerraformOpId;

/** A brush names either one of the 3 primary UI actions or a concrete S0 op (`grade`, `clear`, `break`; API only). */
export type BrushOpSelection = TerraformButtonOp;

export const isPrimaryOp = (op: BrushOpSelection): op is TerraformPrimaryOp =>
  op === 'terraform' || op === 'repair' || op === 'dismantle';

export interface PlannedTileJob {
  q: number;
  r: number;
  op: TerraformButtonOp;
}

export interface BrushPlan {
  jobs: PlannedTileJob[];
  queuedCount: number;
  skippedCount: number;
}

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
  if (kind === ENTITY_KIND.harvester || kind === 'harvester') return 'harvester';
  if (kind === ENTITY_KIND.builder || kind === 'builder' || kind === 'builderDrone') return 'builder';
  if (kind === ENTITY_KIND.terraformer || kind === 'terraformer' || kind === 'terraformerDrone') return 'terraformer';
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

function defaultFootprintForKind(kindName: string): number {
  if (kindName === 'commandHub') return 3;
  if (kindName === 'metalsExtractor' || kindName === 'solar' || kindName === 'tradeHub') return 2;
  return 1;
}

function toInspectableEntity(raw: Record<string, unknown>): InspectableEntity | null {
  // Units stand between hex centres while they walk: the hex they are on is the rounded one (as the host finds them).
  const q = Math.round(typeof raw.q === 'number' ? raw.q : typeof raw.x === 'number' ? raw.x : NaN);
  const r = Math.round(typeof raw.r === 'number' ? raw.r : typeof raw.y === 'number' ? raw.y : NaN);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  const rawKind = (raw.kind ?? raw.building ?? raw.unit ?? 'entity') as number | string;
  const kindName = normalizeEntityKindName(rawKind);
  const defFp = defaultFootprintForKind(kindName);
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

export function extractViewEntities(
  view: GameView | null | undefined,
  hostState?: PlanetState | null,
): InspectableEntity[] {
  const out: InspectableEntity[] = [];
  const v = (view ?? {}) as { entities?: unknown; units?: unknown[]; count?: number };
  if (v.entities instanceof Float32Array) {
    for (const e of viewPlacementWorld(view).entities) {
      const conv = toInspectableEntity(e as unknown as Record<string, unknown>);
      if (conv) out.push(conv);
    }
  } else if (Array.isArray(v.entities)) {
    for (const item of v.entities) {
      if (item && typeof item === 'object') {
        const conv = toInspectableEntity(item as Record<string, unknown>);
        if (conv) out.push(conv);
      }
    }
  }
  if (Array.isArray(v.units)) {
    for (const unit of v.units) {
      if (unit && typeof unit === 'object') {
        const conv = toInspectableEntity(unit as Record<string, unknown>);
        if (conv) out.push(conv);
      }
    }
  }
  if (out.length === 0 && hostState) {
    for (const e of placementWorldFromState(hostState).entities) {
      const conv = toInspectableEntity(e as unknown as Record<string, unknown>);
      if (conv) out.push(conv);
    }
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

/** Checks whether the player has an alive HQ Drone, Harvester, Builder, or Terraformer available to perform terraform/work orders. */
export function hasWorkerEntity(
  entities: readonly InspectableEntity[],
  colonyId: number,
  view?: GameView | null,
): boolean {
  for (const e of entities) {
    if (!isEntityAlive(e)) continue;
    if (e.owner !== undefined && e.owner !== colonyId) continue;
    if (e.kindName === 'hq' || e.kindName === 'harvester' || e.kindName === 'builder' || e.kindName === 'terraformer') return true;
  }
  const colonies = (view as { colonies?: Array<{ index?: number; hq?: { hp?: number; cell?: number } }> } | null)?.colonies;
  const col = colonies?.find((c) => c.index === colonyId) ?? colonies?.[colonyId];
  return Boolean(col?.hq && (col.hq.hp === undefined || col.hq.hp > 0));
}

/** Highest worker tier owned by `colonyId` (`1` in T1, `2` once a T2 worker exists; gates `deepReclaim`). */
export function colonyMaxWorkerTier(
  entities: readonly InspectableEntity[],
  colonyId: number,
  view?: GameView | null,
): number {
  let maxTier = 1;
  for (const e of entities) {
    if (!isEntityAlive(e)) continue;
    if (e.owner !== undefined && e.owner !== colonyId) continue;
    if (e.kindName === 'hq' || e.kindName === 'builder' || e.kindName === 'terraformer') {
      const t = typeof e.tier === 'number' && e.tier > 0 ? e.tier : 1;
      if (t > maxTier) maxTier = t;
    }
  }
  const colonies = (view as { colonies?: Array<{ index?: number; maxWorkerTier?: number; workerTier?: number }> } | null)?.colonies;
  const col = colonies?.find((c, i) => (c?.index ?? i) === colonyId);
  const viewTier = col?.maxWorkerTier ?? col?.workerTier;
  if (typeof viewTier === 'number' && viewTier > maxTier) maxTier = viewTier;
  return maxTier;
}

/** The host's `enqueueTask` auto-prepare rule (the sim's own export, so client and host cannot drift). */
export const hostAutoPrepares = (op: TerraformOpKind, tileCount: number): boolean => enqueueAutoPrepares(op, tileCount);

/** Every `op:q,r` the colony already has queued in the view (the host skips those tiles: never worked twice). */
function pendingJobKeys(view: GameView | null | undefined, colonyId: number): Set<string> {
  const out = new Set<string>();
  for (const o of extractColonyOrders(view, colonyId)) for (const j of o.jobs) out.add(terraformJobKey(j.op, j.q, j.r));
  return out;
}

/**
 * Preview of a brush stroke over the replica view with the sim's own rule (`evaluateTerraform` over a read-only
 * `TerraformWorld`, the function the `enqueueTask` handler runs; D-37, FF-03).
 */
export function planBrushStroke(
  view: GameView | null | undefined,
  tiles: readonly TileCoord[],
  opts: { op: BrushOpSelection; colonyId: number; data?: CompiledDataLike },
): BrushPlan {
  const placement = viewPlacementWorld(view);
  if (placement.tileCount === 0) return { jobs: [], queuedCount: 0, skippedCount: tiles.length };
  const simOp: TerraformOpKind = isTerraformOpKind(opts.op) ? opts.op : 'grade';
  const auto = opts.op === 'terraform' ? true : hostAutoPrepares(simOp, tiles.length);
  const plan = evaluateTerraform(terraformWorldFrom(placement, opts.colonyId, opts.data), {
    colonyId: opts.colonyId,
    op: simOp,
    tiles,
    auto,
    pending: pendingJobKeys(view, opts.colonyId),
    data: opts.data,
  });
  return { jobs: plan.jobs, queuedCount: plan.jobs.length, skippedCount: plan.skipped.length };
}
