import type { RejectCode } from '@terra/contracts';
import { dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { GEO_BLOCK_TEXT, geoBuildBlock, isPreparedGround, MAX_FOOTPRINT_SPREAD_M, type DepositRule, type GeoBlock } from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { defaultW01Data } from '../hq';
import { planPrepJobs, summarizePrepJobs } from './prep';

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
export type PlacementBlock = GeoBlock | 'uneven' | 'outOfMap' | 'foreign' | 'unclaimed' | 'occupied' | 'hubExists' | 'noBuilder' | 'builderBusy' | 'tierLocked' | 'badArgs';

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
};

const BLOCK_TEXT: Readonly<Record<PlacementBlock, string>> = {
  ...GEO_BLOCK_TEXT,
  uneven: 'uneven ground', outOfMap: 'outside the map', foreign: 'not your territory', unclaimed: 'not your territory',
  occupied: 'another building is here', hubExists: 'hub already exists', noBuilder: 'requires HQ',
  builderBusy: 'builder unavailable', tierLocked: 'tier locked', badArgs: 'invalid site',
};

/** Tile-level failures, most important first: the footprint's reason is the highest-ranked one among its tiles. */
const TILE_PRIORITY: readonly PlacementBlock[] = ['outOfMap', 'foreign', 'unclaimed', 'occupied', 'water', 'ridge', 'trees', 'rock', 'slope', 'hole', 'deposit', 'noDeposit'];

export const placementRejectCode = (b: PlacementBlock): RejectCode => BLOCK_CODE[b];
export const placementBlockText = (b: PlacementBlock): string => BLOCK_TEXT[b];

/** Returns `true` when `building` names the Command Hub (`'commandHub' | 'hub' | 'hub.t1' | 'building.commandHub'`). */
export function isHubBuildingKind(building?: string): boolean {
  if (!building) return true;
  const n = building.trim().toLowerCase();
  return n === 'hub' || n === 'commandhub' || n === 'command_hub' || n === 'hub.t1' || n === 'building.commandhub';
}

/** Looks up the Command Hub T1 balance row (`hub.t1`). */
export function resolveHubT1Row(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables.hub as Record<string, CompiledRow> | undefined;
  if (table?.t1) return table.t1;
  return dataRow(defaultW01Data(), 'hub', 't1');
}

/** The placement rule for `building` (W01 knows the Command Hub; other kinds get a 1×1 owned-ground default). */
export function resolvePlacementRule(building?: string, data?: CompiledDataLike): PlacementRule {
  if (isHubBuildingKind(building)) {
    const row = resolveHubT1Row(data);
    return {
      building: 'commandHub',
      isHub: true,
      footprint: Number(row.footprintW ?? row.footprint ?? 3),
      allowUnclaimed: Boolean(row.allowUnclaimedPlacement ?? true),
      hqOnly: Boolean(row.hqOnly ?? true),
      maxPerColony: Number(row.maxPerColony ?? 1),
      deposit: 'forbid',
    };
  }
  return { building: building ?? 'structure', isHub: false, footprint: 1, allowUnclaimed: false, hqOnly: false, maxPerColony: Infinity, deposit: 'forbid' };
}

/** Axial coordinates of an `N × N` footprint anchored at `(q, r)` (3 → the 9 tiles `(q+dq, r+dr)`, `dq, dr ∈ [-1, 1]`). */
export function getBuildingFootprintTiles(q: number, r: number, footprint = 3): Array<{ q: number; r: number }> {
  const size = Math.max(1, Math.trunc(footprint));
  const minOff = -Math.floor((size - 1) / 2);
  const out: Array<{ q: number; r: number }> = [];
  for (let dr = minOff; dr < minOff + size; dr++) for (let dq = minOff; dq < minOff + size; dq++) out.push({ q: q + dq, r: r + dr });
  return out;
}

/** Footprint size of an existing building entity (only kinds ≥ hub occupy ground). */
const entityFootprint = (kind: number): number => (kind === ENTITY_KIND.hub ? 3 : 1);
const isAlive = (e: PlacementEntity): boolean => !(e.hpMax > 0 && e.hp <= 0);

function occupiedTiles(world: PlacementWorld): Set<number> {
  const idx = hexIndex(world.radius);
  const out = new Set<number>();
  for (const e of world.entities) {
    if (e.kind < ENTITY_KIND.hub || !isAlive(e)) continue;
    for (const p of getBuildingFootprintTiles(e.q, e.r, entityFootprint(e.kind))) {
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
  if (block) { tile.ok = false; tile.block = block; }
  return tile;
}

function colonyBlock(world: PlacementWorld, rule: PlacementRule, opts: EvaluatePlacementOpts): PlacementBlock | null {
  const own = world.entities.filter((e) => e.owner === opts.colonyId && isAlive(e));
  if (rule.isHub && own.filter((e) => e.kind === ENTITY_KIND.hub).length >= rule.maxPerColony) return 'hubExists';
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
  const inMap = tiles.filter((t) => t.block !== 'outOfMap');
  const sum = summarizePrepJobs(planPrepJobs(inMap, data), data);
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
  if (!Number.isInteger(colonyId) || colonyId < 0 || !Number.isInteger(q) || !Number.isInteger(r)) return fail('badArgs', [], empty);
  if (tier !== undefined && (!Number.isInteger(tier) || tier < 1 || tier > 3)) return fail('badArgs', [], empty);
  if (tier !== undefined && tier > 1) return fail('tierLocked', [], empty);

  const idx = hexIndex(world.radius);
  const occupied = occupiedTiles(world);
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
