import {
  ENTITY_KIND,
  ENTITY_STATE,
  getBuildingFootprintTiles,
  getHubFootprintTiles,
  hexIndex,
  PREP,
  TERRAIN,
  type ConstructionOrder,
  type PlanetState,
  type SimView,
  type ViewColony,
  type ViewEntity,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { ENTITY_STRIDE, type ClientTiles, type ClientView } from '../../store/replica/viewCodec';

export type GhostSource = PlanetState | ClientView | SimView | GameView | null | undefined;

export interface HubGhostBill {
  tilesToPrepare: number;
  totalTiles: number;
  baseSeconds: number;
  hqSeconds: number;
  totalEnergyE: number;
  yields: {
    'metals.t1': number;
    'bio.biomass': number;
  };
  ops: {
    grade: number;
    clear: number;
    break: number;
  };
}

export interface HubFootprintTileState {
  q: number;
  r: number;
  valid: boolean;
  reasonCode?: string;
  reasonText?: string;
  terrain: number;
  prep: number;
  owner?: number;
}

export interface HubGhostState {
  active: boolean;
  q: number;
  r: number;
  valid: boolean;
  tint: 'valid' | 'invalid';
  reasonCode?: string;
  reasonText?: string;
  footprintTiles: HubFootprintTileState[];
  bill: HubGhostBill;
}

export interface EvaluateHubGhostOptions {
  colonyId?: number;
  q?: number;
  r?: number;
  active?: boolean;
  requireHq?: boolean;
  fallbackTiles?: ClientTiles | null;
}

interface ExtractedEntity {
  id: number;
  kind: number;
  owner: number;
  q: number;
  r: number;
  hp: number;
  hpMax: number;
  state: number;
}

interface ExtractedWorld {
  radius: number;
  tileCount: number;
  terrain: Uint8Array | null;
  prep: Uint8Array | null;
  owner: Int8Array | null;
  entities: ExtractedEntity[];
  orders: ConstructionOrder[];
}

const GRADE_TIME_S = 3;
const CLEAR_TIME_S = 5;
const BREAK_TIME_S = 6;
const GRADE_ENERGY_E = 20;
const CLEAR_ENERGY_E = 30;
const BREAK_ENERGY_E = 60;
const BREAK_METALS_YIELD = 10;
const CLEAR_BIOMASS_YIELD = 5;
const HQ_WORK_RATE = 1.5;

function isPlanetState(src: unknown): src is PlanetState {
  return Boolean(
    src &&
      typeof src === 'object' &&
      'grid' in src &&
      typeof (src as PlanetState).grid?.radius === 'number' &&
      (src as PlanetState).grid?.layers,
  );
}

function extractOrdersFromBlobs(blobs?: Record<string, unknown>, colonyId?: number): ConstructionOrder[] {
  const raw = blobs?.constructionQueue as
    | { value?: unknown; orders?: ConstructionOrder[]; byColony?: Record<number, ConstructionOrder[]> }
    | ConstructionOrder[]
    | undefined;
  if (!raw) return [];
  const inner = (
    typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? raw.value : raw
  ) as { orders?: ConstructionOrder[]; byColony?: Record<number, ConstructionOrder[]> } | ConstructionOrder[];
  let list: ConstructionOrder[] = [];
  if (Array.isArray(inner)) {
    list = inner;
  } else if (inner && typeof inner === 'object') {
    if (colonyId !== undefined && Array.isArray(inner.byColony?.[colonyId])) {
      list = inner.byColony[colonyId];
    } else if (Array.isArray(inner.orders)) {
      list = inner.orders;
    }
  }
  return colonyId === undefined ? list : list.filter((o) => o.colonyId === colonyId);
}

function extractEntitiesFromView(
  rawEntities: Float32Array | ViewEntity[] | undefined,
  rawCount?: number,
): ExtractedEntity[] {
  if (!rawEntities) return [];
  const out: ExtractedEntity[] = [];
  if (rawEntities instanceof Float32Array) {
    const count = rawCount ?? Math.floor(rawEntities.length / ENTITY_STRIDE);
    for (let i = 0; i < count; i++) {
      const o = i * ENTITY_STRIDE;
      out.push({
        id: rawEntities[o],
        kind: rawEntities[o + 1],
        owner: rawEntities[o + 2],
        q: rawEntities[o + 3],
        r: rawEntities[o + 4],
        hp: rawEntities[o + 8],
        hpMax: rawEntities[o + 9],
        state: rawEntities[o + 10],
      });
    }
    return out;
  }
  if (Array.isArray(rawEntities)) {
    for (const e of rawEntities) {
      out.push({
        id: e.id,
        kind: e.kind,
        owner: e.owner,
        q: e.q,
        r: e.r,
        hp: e.hp,
        hpMax: e.hpMax,
        state: e.state,
      });
    }
  }
  return out;
}

function extractWorld(source: GhostSource, fallbackTiles?: ClientTiles | null): ExtractedWorld {
  if (isPlanetState(source)) {
    const e = source.entities;
    const c = e.cols;
    const entities: ExtractedEntity[] = [];
    for (let i = 0; i < e.count; i++) {
      entities.push({
        id: c.id[i],
        kind: c.kind[i],
        owner: c.owner[i],
        q: c.q[i],
        r: c.r[i],
        hp: c.hp[i],
        hpMax: c.hpMax[i],
        state: c.state[i],
      });
    }
    return {
      radius: source.grid.radius,
      tileCount: source.grid.count,
      terrain: source.grid.layers.terrain as Uint8Array,
      prep: source.grid.layers.prep as Uint8Array,
      owner: source.grid.layers.owner as Int8Array,
      entities,
      orders: extractOrdersFromBlobs(source.blobs as unknown as Record<string, unknown>),
    };
  }

  const v = (source ?? {}) as {
    planet?: { radius?: number };
    tiles?: ClientTiles;
    entities?: Float32Array | ViewEntity[];
    count?: number;
    colonies?: ViewColony[];
    blobs?: Record<string, unknown>;
  };
  const tiles = v.tiles ?? fallbackTiles ?? null;
  return {
    radius: typeof v.planet?.radius === 'number' ? v.planet.radius : 12,
    tileCount: tiles?.count ?? 0,
    terrain: tiles?.terrain ?? null,
    prep: tiles?.prep ?? null,
    owner: tiles?.owner ?? null,
    entities: extractEntitiesFromView(v.entities, v.count),
    orders: extractOrdersFromBlobs(v.blobs),
  };
}

function isTilePreparableInW01(terrain: number, prep: number): { valid: boolean; prepared: boolean } {
  if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) {
    return { valid: false, prepared: false };
  }
  if (prep === PREP.prepared || prep === PREP.living) {
    return { valid: true, prepared: true };
  }
  if (terrain === TERRAIN.flat || terrain === TERRAIN.forest || terrain === TERRAIN.rock) {
    return { valid: true, prepared: false };
  }
  return { valid: false, prepared: false };
}

function collectOccupiedTileSet(world: ExtractedWorld): Set<number> {
  const occupied = new Set<number>();
  const idx = hexIndex(world.radius);
  for (const e of world.entities) {
    if (e.kind < ENTITY_KIND.hub) continue;
    if (e.hpMax > 0 && e.hp <= 0) continue;
    const fp = e.kind === ENTITY_KIND.hub ? 3 : 1;
    for (const pos of getBuildingFootprintTiles(e.q, e.r, fp)) {
      const tIdx = idx.indexOf(pos.q, pos.r);
      if (tIdx >= 0) occupied.add(tIdx);
    }
  }
  return occupied;
}

function checkColonyHasHub(world: ExtractedWorld, colonyId: number): boolean {
  for (const e of world.entities) {
    if (e.kind !== ENTITY_KIND.hub || e.owner !== colonyId) continue;
    if (e.hpMax > 0 && e.hp <= 0) continue;
    return true;
  }
  for (const o of world.orders) {
    if (o.colonyId === colonyId && o.status !== 'cancelled') return true;
  }
  return false;
}

function checkColonyHasHq(world: ExtractedWorld, colonyId: number, requireHq?: boolean): boolean {
  let colonyEntities = 0;
  for (const e of world.entities) {
    if (e.owner !== colonyId) continue;
    colonyEntities++;
    if (e.kind !== ENTITY_KIND.hq) continue;
    if (e.hpMax > 0 && e.hp <= 0) continue;
    if (e.state === ENTITY_STATE.descending) continue;
    return true;
  }
  if (requireHq === true) return false;
  if (requireHq === false) return true;
  return colonyEntities === 0;
}

/**
 * Computes the site preparation bill across the 9 tiles of a 3×3 Command Hub footprint at `(q, r)`.
 */
export function computeGhostPrepBill(
  source: GhostSource,
  q: number,
  r: number,
  fallbackTiles?: ClientTiles | null,
): HubGhostBill {
  const world = extractWorld(source, fallbackTiles);
  const coords = getHubFootprintTiles(Math.trunc(q), Math.trunc(r));
  const idx = hexIndex(world.radius);
  const ops = { grade: 0, clear: 0, break: 0 };
  let tilesToPrepare = 0;

  for (const pos of coords) {
    const tIdx = idx.indexOf(pos.q, pos.r);
    if (!world.terrain || !world.prep || tIdx < 0 || tIdx >= world.tileCount) {
      tilesToPrepare++;
      continue;
    }
    const terrain = world.terrain[tIdx];
    const prep = world.prep[tIdx];
    if (prep === PREP.prepared || prep === PREP.living) continue;

    tilesToPrepare++;
    if (terrain === TERRAIN.forest) {
      ops.clear++;
      ops.grade++;
    } else if (terrain === TERRAIN.rock) {
      ops.break++;
      ops.grade++;
    } else if (terrain === TERRAIN.flat) {
      ops.grade++;
    }
  }

  const baseSeconds = ops.grade * GRADE_TIME_S + ops.clear * CLEAR_TIME_S + ops.break * BREAK_TIME_S;
  const hqSeconds = baseSeconds / HQ_WORK_RATE;
  const totalEnergyE = ops.grade * GRADE_ENERGY_E + ops.clear * CLEAR_ENERGY_E + ops.break * BREAK_ENERGY_E;
  const yields = {
    'metals.t1': ops.break * BREAK_METALS_YIELD,
    'bio.biomass': ops.clear * CLEAR_BIOMASS_YIELD,
  };

  return {
    tilesToPrepare,
    totalTiles: coords.length,
    baseSeconds,
    hqSeconds,
    totalEnergyE,
    yields,
    ops,
  };
}

function evaluateSingleFootprintTile(
  world: ExtractedWorld,
  idx: ReturnType<typeof hexIndex>,
  occupied: Set<number>,
  colonyId: number,
  pos: { q: number; r: number },
): HubFootprintTileState {
  const tIdx = idx.indexOf(pos.q, pos.r);
  if (!world.terrain || !world.prep || !world.owner || tIdx < 0 || tIdx >= world.tileCount) {
    return {
      q: pos.q,
      r: pos.r,
      valid: false,
      reasonCode: 'site_blocked',
      reasonText: 'site blocked',
      terrain: TERRAIN.deep,
      prep: PREP.wild,
    };
  }

  const terrain = world.terrain[tIdx];
  const prep = world.prep[tIdx];
  const owner = world.owner[tIdx];
  const check = isTilePreparableInW01(terrain, prep);

  if (owner >= 0 && owner !== colonyId) {
    return {
      q: pos.q,
      r: pos.r,
      valid: false,
      reasonCode: 'not_own_territory',
      reasonText: 'not your territory',
      terrain,
      prep,
      owner,
    };
  }
  if (!check.valid || occupied.has(tIdx)) {
    return {
      q: pos.q,
      r: pos.r,
      valid: false,
      reasonCode: 'site_blocked',
      reasonText: 'site blocked',
      terrain,
      prep,
      owner,
    };
  }
  return {
    q: pos.q,
    r: pos.r,
    valid: true,
    terrain,
    prep,
    owner,
  };
}

/**
 * Evaluates the 3×3 Command Hub placement ghost at `(q, r)` for `colonyId`, returning
 * footprint validity, tint (`'valid' | 'invalid'`), human-readable reason, and live site prep bill.
 */
export function evaluateHubGhost(
  source: GhostSource,
  colonyIdOrOpts: number | EvaluateHubGhostOptions = 0,
  qArg = 0,
  rArg = 0,
  extraOpts?: EvaluateHubGhostOptions,
): HubGhostState {
  const opts: EvaluateHubGhostOptions =
    typeof colonyIdOrOpts === 'number'
      ? { colonyId: colonyIdOrOpts, q: qArg, r: rArg, ...extraOpts }
      : colonyIdOrOpts;
  const colonyId = opts.colonyId ?? 0;
  const q = Math.trunc(opts.q ?? 0);
  const r = Math.trunc(opts.r ?? 0);
  const active = opts.active ?? true;

  const world = extractWorld(source, opts.fallbackTiles);
  const idx = hexIndex(world.radius);
  const coords = getHubFootprintTiles(q, r);
  const occupied = collectOccupiedTileSet(world);
  const footprintTiles = coords.map((pos) =>
    evaluateSingleFootprintTile(world, idx, occupied, colonyId, pos),
  );

  let reasonCode: string | undefined;
  let reasonText: string | undefined;
  const foreignTile = footprintTiles.find((t) => t.reasonCode === 'not_own_territory');
  const blockedTile = footprintTiles.find((t) => !t.valid);

  if (foreignTile) {
    reasonCode = 'not_own_territory';
    reasonText = 'not your territory';
  } else if (checkColonyHasHub(world, colonyId)) {
    reasonCode = 'already_exists';
    reasonText = 'hub already exists';
  } else if (blockedTile) {
    reasonCode = 'site_blocked';
    reasonText = 'site blocked';
  } else if (!checkColonyHasHq(world, colonyId, opts.requireHq)) {
    reasonCode = 'worker_tier_locked';
    reasonText = 'requires HQ';
  }

  const valid = reasonCode === undefined;
  const bill = computeGhostPrepBill(source, q, r, opts.fallbackTiles);

  return {
    active,
    q,
    r,
    valid,
    tint: valid ? 'valid' : 'invalid',
    ...(reasonCode ? { reasonCode, reasonText } : {}),
    footprintTiles,
    bill,
  };
}

/** Extracts active/pending construction orders for `colonyId` from a `GhostSource`. */
export function extractColonyConstructionOrders(
  source: GhostSource,
  colonyId = 0,
): ConstructionOrder[] {
  const world = extractWorld(source);
  return world.orders.filter((o) => o.colonyId === colonyId && o.status !== 'cancelled');
}
