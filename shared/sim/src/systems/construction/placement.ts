import type { RejectCode } from '@terra/contracts';
import type { CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { GEO_BLOCK_TEXT, geoBuildBlock, isPreparedGround, isTileUneven, MAX_FOOTPRINT_SPREAD_M, type DepositRule, type GeoBlock } from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { resolveHubT1Row, resolveStartingKitRow, rowNum } from '../rows';
import { planPrepJobs, summarizePrepJobs } from './prep';

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
}

/** Read-only map + entity snapshot (built from `SimState` on the host, from the replica view in the client). */
export interface PlacementWorld {
  radius: number;
  tileCount: number;
  terrain: ArrayLike<number>;
  prep: ArrayLike<number>;
  deposit: ArrayLike<number> | null;
  owner: ArrayLike<number>;
  /** Ground height (m). With relief (D-38) a footprint must be level: see `MAX_FOOTPRINT_SPREAD_M`. */
  height?: ArrayLike<number> | null;
  valid?: ArrayLike<number> | null;
  entities: readonly PlacementEntity[];
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
}

/** Why a placement fails; maps 1:1 to a protocol `RejectCode` and a UI text. */
export type PlacementBlock =
  | GeoBlock | 'uneven' | 'outOfMap' | 'foreign' | 'unclaimed' | 'occupied' | 'hubExists' | 'noBuilder' | 'builderBusy'
  | 'tierLocked' | 'badArgs' | 'unknownBuilding' | 'farFromLanding' | 'nearOtherColony';

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
  yields: { 'metals.t1': number; 'bio.biomass': number };
  ops: { grade: number; clear: number; break: number };
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
  data?: CompiledDataLike;
}

const BLOCK_CODE: Readonly<Record<PlacementBlock, RejectCode>> = {
  water: 'terrain_unbuildable', trees: 'terrain_unbuildable', rock: 'terrain_unbuildable', slope: 'terrain_unbuildable',
  hole: 'terrain_unbuildable', ridge: 'terrain_unbuildable', uneven: 'terrain_unbuildable', deposit: 'terrain_unbuildable', noDeposit: 'terrain_unbuildable',
  outOfMap: 'site_blocked', occupied: 'site_blocked', hubExists: 'site_blocked',
  foreign: 'not_own_territory', unclaimed: 'not_own_territory',
  noBuilder: 'worker_tier_locked', builderBusy: 'worker_tier_locked', tierLocked: 'tier_locked', badArgs: 'invalid_args',
  unknownBuilding: 'invalid_args', farFromLanding: 'site_blocked', nearOtherColony: 'site_blocked',
};

const BLOCK_TEXT: Readonly<Record<PlacementBlock, string>> = {
  ...GEO_BLOCK_TEXT,
  uneven: 'uneven ground', outOfMap: 'outside the map', foreign: 'not your territory', unclaimed: 'not your territory',
  occupied: 'another building is here', hubExists: 'hub already exists', noBuilder: 'requires HQ',
  builderBusy: 'builder unavailable', tierLocked: 'tier locked', badArgs: 'invalid site', unknownBuilding: 'unknown building',
  farFromLanding: 'too far from your landing', nearOtherColony: 'closer to another colony',
};

/** Tile-level failures, most important first: the footprint's reason is the highest-ranked one among its tiles. */
const TILE_PRIORITY: readonly PlacementBlock[] = ['outOfMap', 'foreign', 'unclaimed', 'occupied', 'water', 'ridge', 'trees', 'rock', 'slope', 'hole', 'uneven', 'deposit', 'noDeposit'];

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

/** The placement rule of `building` from its row, or `null` when the building is unknown. */
export function resolvePlacementRule(building?: string, data?: CompiledDataLike): PlacementRule | null {
  const row = resolveBuildingRow(building, data);
  if (!row) return null;
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

/** Whether an entity occupies ground with its footprint: an alive building (GP-23: one rule for placement and paths). */
export function occupiesGround(e: { kind: number; hp: number; hpMax: number }): boolean {
  return e.kind === ENTITY_KIND.hub && !(e.hpMax > 0 && e.hp <= 0);
}

/** Footprint size of an existing building entity of `kind` (its row's `footprint`). */
export function entityFootprint(kind: number, data?: CompiledDataLike): number {
  return kind === ENTITY_KIND.hub ? rowNum(resolveHubT1Row(data), 'footprint') : 1;
}

const isAlive = (e: PlacementEntity): boolean => !(e.hpMax > 0 && e.hp <= 0);

function occupiedTiles(world: PlacementWorld, data?: CompiledDataLike): Set<number> {
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

function evaluateTile(world: PlacementWorld, rule: PlacementRule, colonyId: number, occupied: Set<number>, q: number, r: number, tileIdx: number): PlacementTile {
  const inMap = tileIdx >= 0 && tileIdx < world.tileCount && (!world.valid || world.valid[tileIdx] !== 0);
  if (!inMap) return { q, r, tileIdx, terrain: -1, prep: -1, deposit: 0, owner: -1, prepared: false, ok: false, block: 'outOfMap' };
  const terrain = world.terrain[tileIdx], prep = world.prep[tileIdx], owner = world.owner[tileIdx];
  const deposit = world.deposit ? world.deposit[tileIdx] : 0;
  const tile: PlacementTile = { q, r, tileIdx, terrain, prep, deposit, owner, prepared: isPreparedGround(prep), ok: true };
  let block: PlacementBlock | null;
  if (owner >= 0 && owner !== colonyId) block = 'foreign';
  else if (owner < 0 && !rule.allowUnclaimed) block = 'unclaimed';
  else if (occupied.has(tileIdx)) block = 'occupied';
  else block = geoBuildBlock(terrain, prep, deposit, rule.deposit);
  if (!block && isTileUneven(world.radius, tileIdx, world.terrain, world.height)) block = 'uneven';
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
  // Only the prep the linked order would really do: buildable tiles (Grade). Blocked tiles (trees, rock, …) are the
  // player's own terraform ops, so an invalid site never advertises Break / Clear work or their yields (D-37).
  const buildable = tiles.filter((t) => t.ok);
  const sum = summarizePrepJobs(planPrepJobs(buildable, data), data);
  return {
    tilesToPrepare: tiles.filter((t) => !t.prepared).length,
    totalTiles: tiles.length,
    baseSeconds: sum.baseSeconds,
    hqSeconds: sum.hqSeconds,
    totalEnergyE: sum.totalEnergyE,
    yields: sum.yields,
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

const fail = (block: PlacementBlock, tiles: PlacementTile[], bill: PlacementBill): PlacementResult => {
  const prepared = tiles.filter((t) => t.prepared).length;
  return { ok: false, code: BLOCK_CODE[block], block, text: BLOCK_TEXT[block], tiles, preparedCount: prepared, unpreparedCount: tiles.length - prepared, bill };
};

/**
 * Validates placing `opts.building` with its footprint centred at `(q, r)` for `opts.colonyId` (`UO-TF-01/05`, `UO-L-03`).
 * Every footprint tile must be inside the map, owned by the colony (or unclaimed when the rule allows it), free of other
 * buildings and geo-buildable: Flat ground, no trees / rock (terraform first), no water, slope, hole, ridge or deposit.
 */
export function evaluatePlacement(world: PlacementWorld, opts: EvaluatePlacementOpts): PlacementResult {
  const rule = resolvePlacementRule(opts.building, opts.data);
  const { colonyId, q, r, tier } = opts;
  const empty: PlacementBill = { tilesToPrepare: 0, totalTiles: 0, baseSeconds: 0, hqSeconds: 0, totalEnergyE: 0, yields: { 'metals.t1': 0, 'bio.biomass': 0 }, ops: { grade: 0, clear: 0, break: 0 } };
  if (!rule) return fail('unknownBuilding', [], empty);
  if (!Number.isInteger(colonyId) || colonyId < 0 || !Number.isInteger(q) || !Number.isInteger(r)) return fail('badArgs', [], empty);
  if (tier !== undefined && (!Number.isInteger(tier) || tier < 1 || tier > 3)) return fail('badArgs', [], empty);
  if (tier !== undefined && tier > 1) return fail('tierLocked', [], empty);

  const idx = hexIndex(world.radius);
  const occupied = occupiedTiles(world, opts.data);
  const tiles = getBuildingFootprintTiles(q, r, rule.footprint).map((p) => evaluateTile(world, rule, colonyId, occupied, p.q, p.r, idx.indexOf(p.q, p.r)));
  const bill = billFor(tiles, opts.data);
  for (const b of TILE_PRIORITY) if (tiles.some((t) => t.block === b)) return fail(b, tiles, bill);
  if (footprintSpread(world, tiles) > MAX_FOOTPRINT_SPREAD_M) return fail('uneven', tiles, bill);
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
