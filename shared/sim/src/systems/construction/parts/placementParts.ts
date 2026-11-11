import { compileData, type CompiledRow } from '../../../data';
import { ENTITY_KIND } from '../../../ecs/columns';
import type { GeoBuildOptions } from '../../../grid/geo';
import { hexIndex } from '../../../grid/hex';
import { DEPOSIT } from '../../../grid/layers';
import type { CompiledDataLike } from '../../../kernel/config';
import { resolveHubT1Row, rowNum } from '../../rows';
import { getTerraformOpSpec } from '../../terraform-basic/ops';
import type { PlacementEntity, PlacementRule, PlacementWorld } from '../placement';

/** The building a W01 Hub row stands for: its `building` name and its `archetype` both name it. */
function hubRowNames(row: CompiledRow): string[] {
  return [row.building, row.archetype].filter((v): v is string => typeof v === 'string');
}

/** Returns `true` when `building` names the Command Hub (`hub.t1.building` / `archetype`; omitted = the Hub). */
export function isHubBuildingKind(building?: string, data?: CompiledDataLike): boolean {
  return building === undefined || hubRowNames(resolveHubT1Row(data)).includes(building);
}

/**
 * The balance row of `building` (W01 knows one building, the Command Hub `hub.t1`), or `null` for a kind the data
 * does not know (GP-05: such a placement is refused `invalid_args`, never built as a stand-in Hub).
 */
export function resolveBuildingRow(building: string | undefined, data?: CompiledDataLike): CompiledRow | null {
  return isHubBuildingKind(building, data) ? resolveHubT1Row(data) : null;
}

let defaultEconomyData: CompiledDataLike | null = null;
const ECONOMY_BUILDING_ALIASES: Readonly<Record<string, string>> = {
  extractor: 'metalsExtractor',
  solarCollector: 'solar',
  depot: 'supplyDepot',
  quarry: 'mineralsQuarry',
  water: 'waterExtractor',
  waterPump: 'waterExtractor',
  coalGen: 'thermal',
  thermalPlant: 'thermal',
  oilWell: 'petroleumWell',
  droneArray: 'droneControlArray',
  turret: 'autocannon',
  pulseTurret: 'laserTower',
};

/** The W02/W03/W07 T1 building row (`economyT1Basic`, `grid`, or `combatUnits`, `kind: 'building'`) named `building`, or `null`. */
export function resolveEconomyBuildingRow(building: string | undefined, data?: CompiledDataLike): CompiledRow | null {
  if (building === undefined) return null;
  const canonical = ECONOMY_BUILDING_ALIASES[building] ?? building;
  const fallback = (defaultEconomyData ??= compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W07', 'W10'])));
  if (building === 'tradeHub' || building === 'interColonyTradeHub') {
    const src = data?.tables ? data : fallback;
    const thRow = (src.tables.tradeHub as Record<string, CompiledRow> | undefined)?.t1;
    return thRow && thRow.kind === 'building' ? thRow : null;
  }
  const ecoSrc = data?.tables?.economyT1Basic ? data : fallback;
  const ecoRow = (ecoSrc.tables.economyT1Basic as Record<string, CompiledRow> | undefined)?.[canonical];
  if (ecoRow && ecoRow.kind === 'building') return ecoRow;
  const gridSrc = data?.tables?.grid ? data : fallback;
  const gridRow = (gridSrc.tables.grid as Record<string, CompiledRow> | undefined)?.[canonical];
  if (gridRow && gridRow.kind === 'building') return gridRow;
  const combatSrc = data?.tables?.combatUnits ? data : fallback;
  const combatRow = (combatSrc.tables.combatUnits as Record<string, CompiledRow> | undefined)?.[canonical];
  return combatRow && combatRow.kind === 'building' ? combatRow : null;
}

/**
 * The placement rule of a W02 building row (D-37, W02-09): its square footprint (`footprintW`), any deposit allowed on
 * the tiles of an extractor that must cover its `requiresDeposit` family, no deposit under any other building. Unclaimed
 * ground is allowed for now (as the W02 build path always did; foreign territory never is).
 */
function economyPlacementRule(row: CompiledRow): PlacementRule {
  const requires = typeof row.requiresDeposit === 'string' ? DEPOSIT[row.requiresDeposit as keyof typeof DEPOSIT] : undefined;
  return {
    building: String(row.building ?? row.id),
    isHub: false,
    footprint: Number(row.footprintW ?? row.footprint ?? 2),
    allowUnclaimed: true,
    hqOnly: false,
    maxPerColony: Number.POSITIVE_INFINITY,
    deposit: requires !== undefined ? 'any' : 'forbid',
    ...(requires !== undefined ? { requiresDeposit: requires } : {}),
  };
}

/** The placement rule of `building` from its row (the Command Hub, or a W02 building row), or `null` when unknown. */
export function resolvePlacementRule(building?: string, data?: CompiledDataLike): PlacementRule | null {
  const row = resolveBuildingRow(building, data);
  if (!row) {
    const eco = resolveEconomyBuildingRow(building, data);
    return eco ? economyPlacementRule(eco) : null;
  }
  return {
    building: String(row.building),
    isHub: true,
    footprint: rowNum(row, 'footprint'),
    allowUnclaimed: row.allowUnclaimedPlacement === true,
    hqOnly: row.hqOnly === true,
    maxPerColony: rowNum(row, 'maxPerColony'),
    deposit: 'forbid',
  };
}

/** Axial coordinates of an `N × N` footprint anchored at `(q, r)` (3 → the 9 tiles `(q+dq, r+dr)`, `dq, dr ∈ [-1, 1]`). */
export function getBuildingFootprintTiles(q: number, r: number, footprint = 3): Array<{ q: number; r: number }> {
  const size = Math.max(1, Math.trunc(footprint));
  const minOff = -Math.floor((size - 1) / 2);
  const out: Array<{ q: number; r: number }> = [];
  for (let dr = minOff; dr < minOff + size; dr++) for (let dq = minOff; dq < minOff + size; dq++) out.push({ q: q + dq, r: r + dr });
  return out;
}

export const OCCUPYING_BUILDING_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.commandHub,
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.solar,
  ENTITY_KIND.pylon,
  ENTITY_KIND.capacitor,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.supplyDepot,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
  ENTITY_KIND.tradeHub,
  ENTITY_KIND.roboticsFactory,
  ENTITY_KIND.droneControlArray,
  ENTITY_KIND.autocannon,
  ENTITY_KIND.laserTower,
  ENTITY_KIND.hiveBlackAnt,
  ENTITY_KIND.hiveBlueBeetle,
  ENTITY_KIND.hiveGreenSpitter,
]);

const OCCUPYING_KINDS = OCCUPYING_BUILDING_KINDS;

/** Whether an entity occupies ground with its footprint: an alive building (GP-23: one rule for placement and paths). */
export function occupiesGround(e: { kind: number; hp: number; hpMax: number }): boolean {
  return OCCUPYING_KINDS.has(e.kind) && !(e.hpMax > 0 && e.hp <= 0);
}

/** Footprint size of an existing building entity of `kind` (its row's `footprint`). */
export function entityFootprint(kind: number, data?: CompiledDataLike): number {
  if (kind === ENTITY_KIND.commandHub) return rowNum(resolveHubT1Row(data), 'footprint');
  if (kind === ENTITY_KIND.roboticsFactory) return 3;
  if (
    kind === ENTITY_KIND.pylon ||
    kind === ENTITY_KIND.droneControlArray ||
    kind === ENTITY_KIND.autocannon ||
    kind === ENTITY_KIND.laserTower ||
    kind === ENTITY_KIND.hiveBlackAnt ||
    kind === ENTITY_KIND.hiveBlueBeetle ||
    kind === ENTITY_KIND.hiveGreenSpitter
  ) {
    return 1;
  }
  if (OCCUPYING_KINDS.has(kind)) return 2;
  return 1;
}

export const isAlive = (e: PlacementEntity): boolean => !(e.hpMax > 0 && e.hp <= 0);

/** W05-09 (re-opening D-37): linked site prep covers trees, rock, slope, holes and water once the W05 ops are compiled. */
export function linkedPrepActive(data?: CompiledDataLike): boolean {
  return Boolean((data?.tables?.opsBasic as Record<string, unknown> | undefined)?.level);
}

/**
 * The best tier among `colonyId`'s alive HQ and Worker Drones (1 when none), the one rule for what a colony's workers
 * may do (`deepReclaim.minWorkerTier`): placement, linked prep and the terraform rule read it, on the host and the client.
 */
export function colonyMaxWorkerTier(world: Pick<PlacementWorld, 'entities' | 'maxWorkerTierByColony'>, colonyId: number): number {
  let max = Math.max(1, world.maxWorkerTierByColony?.[colonyId] ?? 1);
  for (const e of world.entities) {
    if (e.owner !== colonyId || !isAlive(e) || (e.kind !== ENTITY_KIND.hq && e.kind !== ENTITY_KIND.worker)) continue;
    const t = typeof e.tier === 'number' && e.tier > 0 ? e.tier : 1;
    if (t > max) max = t;
  }
  return max;
}

/** The `geoBuildBlock` options of `colonyId` (linked prep on, deep water once a worker of `deepReclaim`'s tier exists). */
export function geoBuildOptionsFor(world: Pick<PlacementWorld, 'entities' | 'maxWorkerTierByColony'>, colonyId: number, data?: CompiledDataLike): GeoBuildOptions {
  const linkedPrep = linkedPrepActive(data);
  const deepCompiled = linkedPrep && 'deepReclaim' in (data!.tables.opsBasic as Record<string, unknown>);
  return {
    linkedPrep,
    canDeepReclaim: deepCompiled && colonyMaxWorkerTier(world, colonyId) >= getTerraformOpSpec('deepReclaim', data).minWorkerTier,
  };
}

/** Tiles under an alive building's footprint (GP-23: the same set placement, paths and terraform block). */
export function occupiedTiles(world: PlacementWorld, data?: CompiledDataLike): Set<number> {
  const idx = hexIndex(world.radius);
  const out = new Set<number>();
  for (const e of world.entities) {
    if (!occupiesGround(e)) continue;
    for (const p of getBuildingFootprintTiles(e.q, e.r, entityFootprint(e.kind, data))) {
      const i = idx.indexOf(p.q, p.r);
      if (i >= 0) out.add(i);
    }
  }
  return out;
}
