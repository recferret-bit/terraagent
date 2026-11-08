import type { RejectCode, ResourceKey } from '@terra/contracts';
import { compileData, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import {
  GEO_BLOCK_TEXT, geoBuildBlock, isPreparedGround, isTileUneven, MAX_FOOTPRINT_SPREAD_M, type DepositRule, type GeoBlock, type GeoBuildOptions,
} from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import { resolveHubT1Row, resolveStartingKitRow, rowNum } from '../rows';
import { getTerraformOpSpec } from '../terraform-basic/ops';
import { inPowerZone, placementPowerZoneSources, powerZoneActive, type PowerZoneSource } from './powerZone';
import { planPrepJobs, summarizePrepJobs, type SitePrepOpCounts } from './prep';

export { resolveHubT1Row } from '../rows';

/**
 * Building placement rules, one pure function for every caller: the authoritative `placeBuilding` handler (server and
 * browser-local host run the same sim), the client ghost (green / red tint, reason, prep bill) and the starter-site
 * guarantee. Callers adapt their data into a read-only `PlacementWorld`; nothing here touches `SimState`.
 */

/** One entity as placement sees it. */
export interface PlacementEntity {
  id: number;
  kind: number;
  owner: number;
  q: number;
  r: number;
  hp: number;
  hpMax: number;
  state: number;
  tier?: number;
}

/** Read-only map + entity snapshot (built from `SimState` on the host, from the replica view in the client). */
export interface PlacementWorld {
  radius: number;
  tileCount: number;
  terrain: ArrayLike<number>;
  prep: ArrayLike<number>;
  deposit: ArrayLike<number> | null;
  richness?: ArrayLike<number> | null;
  owner: ArrayLike<number>;
  /** Ground height (m). With relief (D-38) a footprint must be level: see `MAX_FOOTPRINT_SPREAD_M`. */
  height?: ArrayLike<number> | null;
  valid?: ArrayLike<number> | null;
  entities: readonly PlacementEntity[];
  /** Open build orders without a site entity yet (a queued Power Pylon already extends the power zone, `powerZone.ts`). */
  plannedSites?: ReadonlyArray<{ owner: number; building: string; q: number; r: number }>;
  /**
   * Best HQ / Worker Drone tier per colony index, for worlds whose entity rows carry no `tier` (a client replica: the
   * host publishes `colonies[].maxWorkerTier` on its view). The host leaves it out: its entities carry their tier.
   */
  maxWorkerTierByColony?: Readonly<Record<number, number>>;
}

/** Per-building placement rule (balance rows supply the numbers; the geo part is fixed per building class). */
export interface PlacementRule {
  building: string;
  isHub: boolean;
  footprint: number;
  allowUnclaimed: boolean;
  hqOnly: boolean;
  maxPerColony: number;
  deposit: DepositRule;
  /** The footprint must cover at least one non-depleted tile of this `DEPOSIT` code (Metals Extractor, W02-08). */
  requiresDeposit?: number;
}

/** Why a placement fails; maps 1:1 to a protocol `RejectCode` and a UI text. */
export type PlacementBlock =
  | GeoBlock | 'uneven' | 'outOfMap' | 'foreign' | 'unclaimed' | 'occupied' | 'hubExists' | 'noBuilder' | 'builderBusy'
  | 'tierLocked' | 'badArgs' | 'unknownBuilding' | 'farFromLanding' | 'nearOtherColony' | 'outsidePowerZone';

export interface PlacementTile {
  q: number;
  r: number;
  tileIdx: number;
  terrain: number;
  prep: number;
  deposit: number;
  owner: number;
  prepared: boolean;
  ok: boolean;
  block?: PlacementBlock;
}

export interface PlacementBill {
  tilesToPrepare: number;
  totalTiles: number;
  baseSeconds: number;
  hqSeconds: number;
  totalEnergyE: number;
  yields: { 'metals.t1': number; 'bio.biomass': number; 'minerals.t1'?: number };
  cost?: Partial<Record<ResourceKey, number>>;
  ops: SitePrepOpCounts;
}

export interface PlacementResult {
  ok: boolean;
  code?: RejectCode;
  block?: PlacementBlock;
  text?: string;
  tiles: PlacementTile[];
  preparedCount: number;
  unpreparedCount: number;
  bill: PlacementBill;
}

export interface EvaluatePlacementOpts {
  colonyId: number;
  q: number;
  r: number;
  building?: string;
  tier?: number;
  builderEntityId?: number;
  /** `false` skips the "colony has a landed HQ" check (ghost previews before landing). */
  requireBuilder?: boolean;
  /** Only the Command Hub is placeable (the `placeBuilding` command; W02 buildings go through `enqueueTask`). */
  hubOnly?: boolean;
  data?: CompiledDataLike;
}

const BLOCK_CODE: Readonly<Record<PlacementBlock, RejectCode>> = {
  water: 'terrain_unbuildable', trees: 'terrain_unbuildable', rock: 'terrain_unbuildable', slope: 'terrain_unbuildable',
  hole: 'terrain_unbuildable', ridge: 'terrain_unbuildable', uneven: 'terrain_unbuildable', deposit: 'terrain_unbuildable', noDeposit: 'site_blocked',
  outOfMap: 'site_blocked', occupied: 'site_blocked', hubExists: 'site_blocked',
  foreign: 'not_own_territory', unclaimed: 'not_own_territory',
  noBuilder: 'worker_tier_locked', builderBusy: 'worker_tier_locked', tierLocked: 'tier_locked', badArgs: 'invalid_args',
  unknownBuilding: 'invalid_args', farFromLanding: 'site_blocked', nearOtherColony: 'site_blocked',
  outsidePowerZone: 'outside_power_zone',
};

const BLOCK_TEXT: Readonly<Record<PlacementBlock, string>> = {
  ...GEO_BLOCK_TEXT,
  uneven: 'uneven ground', outOfMap: 'outside the map', foreign: 'not your territory', unclaimed: 'not your territory',
  occupied: 'another building is here', hubExists: 'hub already exists', noBuilder: 'requires HQ',
  builderBusy: 'builder unavailable', tierLocked: 'tier locked', badArgs: 'invalid site', unknownBuilding: 'unknown building',
  farFromLanding: 'too far from your landing', nearOtherColony: 'closer to another colony',
  outsidePowerZone: 'outside the power zone',
};

/** Tile-level failures, most important first: the footprint's reason is the highest-ranked one among its tiles. */
const TILE_PRIORITY: readonly PlacementBlock[] = ['outOfMap', 'foreign', 'unclaimed', 'outsidePowerZone', 'occupied', 'water', 'ridge', 'trees', 'rock', 'slope', 'hole', 'uneven', 'deposit', 'noDeposit'];

export const placementRejectCode = (b: PlacementBlock): RejectCode => BLOCK_CODE[b];
export const placementBlockText = (b: PlacementBlock): string => BLOCK_TEXT[b];

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
};

/** The W02/W03 T1 building row (`economyT1Basic` or `grid`, `kind: 'building'`) named `building`, or `null`. */
export function resolveEconomyBuildingRow(building: string | undefined, data?: CompiledDataLike): CompiledRow | null {
  if (building === undefined) return null;
  const canonical = ECONOMY_BUILDING_ALIASES[building] ?? building;
  const fallback = (defaultEconomyData ??= compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W10'])));
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
  return gridRow && gridRow.kind === 'building' ? gridRow : null;
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
]);

const OCCUPYING_KINDS = OCCUPYING_BUILDING_KINDS;

/** Whether an entity occupies ground with its footprint: an alive building (GP-23: one rule for placement and paths). */
export function occupiesGround(e: { kind: number; hp: number; hpMax: number }): boolean {
  return OCCUPYING_KINDS.has(e.kind) && !(e.hpMax > 0 && e.hp <= 0);
}

/** Footprint size of an existing building entity of `kind` (its row's `footprint`). */
export function entityFootprint(kind: number, data?: CompiledDataLike): number {
  if (kind === ENTITY_KIND.commandHub) return rowNum(resolveHubT1Row(data), 'footprint');
  if (kind === ENTITY_KIND.pylon) return 1;
  if (OCCUPYING_KINDS.has(kind)) return 2;
  return 1;
}

const isAlive = (e: PlacementEntity): boolean => !(e.hpMax > 0 && e.hp <= 0);

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

/** What every footprint tile is judged against: the colony, the occupied tiles and the power zone (`null`: no zone rule). */
interface TileContext {
  colonyId: number;
  occupied: Set<number>;
  zone: readonly PowerZoneSource[] | null;
  geo: GeoBuildOptions;
}

function evaluateTile(world: PlacementWorld, rule: PlacementRule, ctx: TileContext, q: number, r: number, tileIdx: number): PlacementTile {
  const { colonyId, occupied, zone, geo } = ctx;
  const linkedPrep = Boolean(geo.linkedPrep);
  const inMap = tileIdx >= 0 && tileIdx < world.tileCount && (!world.valid || world.valid[tileIdx] !== 0);
  if (!inMap) return { q, r, tileIdx, terrain: -1, prep: -1, deposit: 0, owner: -1, prepared: false, ok: false, block: 'outOfMap' };
  const terrain = world.terrain[tileIdx], prep = world.prep[tileIdx], owner = world.owner[tileIdx];
  const deposit = world.deposit ? world.deposit[tileIdx] : 0;
  const tile: PlacementTile = { q, r, tileIdx, terrain, prep, deposit, owner, prepared: isPreparedGround(prep), ok: true };
  let block: PlacementBlock | null;
  if (owner >= 0 && owner !== colonyId) block = 'foreign';
  else if (owner < 0 && !rule.allowUnclaimed) block = 'unclaimed';
  else if (zone && !inPowerZone(zone, q, r)) block = 'outsidePowerZone';
  else if (occupied.has(tileIdx)) block = 'occupied';
  else {
    const isDepleted = deposit !== 0 && world.richness != null && Number(world.richness[tileIdx] ?? 0) <= 0;
    const effectiveDeposit = rule.deposit === 'require' && isDepleted ? 0 : deposit;
    block = geoBuildBlock(terrain, prep, effectiveDeposit, rule.deposit, geo);
  }
  if (!block && !(linkedPrep && !tile.prepared) && isTileUneven(world.radius, tileIdx, world.terrain, world.height)) block = 'uneven';
  if (block) { tile.ok = false; tile.block = block; }
  return tile;
}

/**
 * Where a Hub may stand relative to the landings (GP-06): within `hq.startingKit.hubMaxDistFromLanding` of the colony's
 * own pod, and not closer to another colony's pod or Hub than to its own pod. Without an own pod (no landing yet, tests)
 * there is no distance rule.
 */
function landingBlock(world: PlacementWorld, opts: EvaluatePlacementOpts): PlacementBlock | null {
  const pod = world.entities.find((e) => e.kind === ENTITY_KIND.pod && e.owner === opts.colonyId);
  if (!pod) return null;
  const own = hexDistance(opts.q, opts.r, pod.q, pod.r);
  if (own > rowNum(resolveStartingKitRow(opts.data), 'hubMaxDistFromLanding')) return 'farFromLanding';
  const others = world.entities.filter((e) => (e.kind === ENTITY_KIND.pod || e.kind === ENTITY_KIND.hub) && e.owner >= 0 && e.owner !== opts.colonyId && isAlive(e));
  return others.some((e) => hexDistance(opts.q, opts.r, e.q, e.r) < own) ? 'nearOtherColony' : null;
}

function colonyBlock(world: PlacementWorld, rule: PlacementRule, opts: EvaluatePlacementOpts): PlacementBlock | null {
  const own = world.entities.filter((e) => e.owner === opts.colonyId && isAlive(e));
  if (rule.isHub && own.filter((e) => e.kind === ENTITY_KIND.hub).length >= rule.maxPerColony) return 'hubExists';
  if (rule.isHub) {
    const far = landingBlock(world, opts);
    if (far) return far;
  }
  if (opts.builderEntityId !== undefined) {
    const b = world.entities.find((e) => e.id === opts.builderEntityId);
    if (!b || !isAlive(b)) return 'noBuilder';
    if (b.owner !== opts.colonyId) return 'noBuilder';
    if (b.state === ENTITY_STATE.descending || (rule.hqOnly && b.kind !== ENTITY_KIND.hq)) return 'builderBusy';
    return null;
  }
  if (rule.hqOnly && opts.requireBuilder !== false && !own.some((e) => e.kind === ENTITY_KIND.hq && e.state !== ENTITY_STATE.descending)) return 'noBuilder';
  return null;
}

function billFor(tiles: readonly PlacementTile[], data?: CompiledDataLike): PlacementBill {
  // Only the prep the linked order would really do: buildable tiles. Blocked tiles are not billed (D-37).
  const buildable = tiles.filter((t) => t.ok);
  const sum = summarizePrepJobs(planPrepJobs(buildable, data), data);
  return {
    tilesToPrepare: tiles.filter((t) => !t.prepared).length,
    totalTiles: tiles.length,
    baseSeconds: sum.baseSeconds,
    hqSeconds: sum.hqSeconds,
    totalEnergyE: sum.totalEnergyE,
    yields: sum.yields,
    ...(sum.cost ? { cost: sum.cost } : {}),
    ops: sum.countsByOp,
  };
}

function footprintSpread(world: PlacementWorld, tiles: readonly PlacementTile[]): number {
  if (!world.height) return 0;
  let lo = Infinity, hi = -Infinity;
  for (const t of tiles) {
    const h = world.height[t.tileIdx];
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return tiles.length ? hi - lo : 0;
}

/** Whether footprint tile `t` holds a non-depleted deposit of code `deposit`. */
const coversDeposit = (world: PlacementWorld, t: PlacementTile, deposit: number): boolean =>
  t.deposit === deposit && !(world.richness != null && Number(world.richness[t.tileIdx] ?? 0) <= 0);

const fail = (block: PlacementBlock, tiles: PlacementTile[], bill: PlacementBill): PlacementResult => {
  const prepared = tiles.filter((t) => t.prepared).length;
  return { ok: false, code: BLOCK_CODE[block], block, text: BLOCK_TEXT[block], tiles, preparedCount: prepared, unpreparedCount: tiles.length - prepared, bill };
};

/**
 * Validates placing `opts.building` with its footprint centred at `(q, r)` for `opts.colonyId` (`UO-TF-01/05`, `UO-L-03`).
 * Every footprint tile must be inside the map, owned by the colony (or unclaimed when the rule allows it), inside the
 * colony's power zone (every building but the Command Hub, from W03 on: `powerZone.ts`), free of other buildings and
 * geo-buildable: Flat ground, no trees / rock (terraform first), no water, slope, hole, ridge or deposit.
 */
export function evaluatePlacement(world: PlacementWorld, opts: EvaluatePlacementOpts): PlacementResult {
  const rule = resolvePlacementRule(opts.building, opts.data);
  const { colonyId, q, r, tier } = opts;
  const empty: PlacementBill = { tilesToPrepare: 0, totalTiles: 0, baseSeconds: 0, hqSeconds: 0, totalEnergyE: 0, yields: { 'metals.t1': 0, 'bio.biomass': 0 }, ops: { grade: 0, clear: 0, break: 0 } };
  if (!rule || (opts.hubOnly && !rule.isHub)) return fail('unknownBuilding', [], empty);
  if (!Number.isInteger(colonyId) || colonyId < 0 || !Number.isInteger(q) || !Number.isInteger(r)) return fail('badArgs', [], empty);
  if (tier !== undefined && (!Number.isInteger(tier) || tier < 1 || tier > 3)) return fail('badArgs', [], empty);
  if (tier !== undefined && tier > 1) return fail('tierLocked', [], empty);

  const idx = hexIndex(world.radius);
  const zone = !rule.isHub && powerZoneActive(opts.data) ? placementPowerZoneSources(world, colonyId, opts.data) : null;
  const geo = geoBuildOptionsFor(world, colonyId, opts.data);
  const linkedPrep = Boolean(geo.linkedPrep);
  const ctx: TileContext = { colonyId, occupied: occupiedTiles(world, opts.data), zone, geo };
  const tiles = getBuildingFootprintTiles(q, r, rule.footprint).map((p) => evaluateTile(world, rule, ctx, p.q, p.r, idx.indexOf(p.q, p.r)));
  const bill = billFor(tiles, opts.data);
  for (const b of TILE_PRIORITY) if (tiles.some((t) => t.block === b)) return fail(b, tiles, bill);
  if (!(linkedPrep && tiles.some((t) => !t.prepared)) && footprintSpread(world, tiles) > MAX_FOOTPRINT_SPREAD_M) return fail('uneven', tiles, bill);
  if (rule.requiresDeposit !== undefined && !tiles.some((t) => coversDeposit(world, t, rule.requiresDeposit!) || (rule.requiresDeposit === DEPOSIT.metals && coversDeposit(world, t, DEPOSIT.minerals)))) return fail('noDeposit', tiles, bill);
  const cb = colonyBlock(world, rule, opts);
  if (cb) return fail(cb, tiles, bill);
  const prepared = tiles.filter((t) => t.prepared).length;
  return { ok: true, tiles, preparedCount: prepared, unpreparedCount: tiles.length - prepared, bill };
}

/** Nearest valid site (by hex distance, then r, then q) within `radius` of `(q, r)`, or `null`. */
export function findPlacementSite(world: PlacementWorld, opts: EvaluatePlacementOpts, radius: number): { q: number; r: number } | null {
  const cands: Array<{ q: number; r: number; d: number }> = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dq = -radius; dq <= radius; dq++) {
      const d = hexDistance(0, 0, dq, dr);
      if (d <= radius) cands.push({ q: opts.q + dq, r: opts.r + dr, d });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.r - b.r || a.q - b.q);
  for (const c of cands) if (evaluatePlacement(world, { ...opts, q: c.q, r: c.r }).ok) return { q: c.q, r: c.r };
  return null;
}
