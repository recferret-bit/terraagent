import { ENTITY_KIND, ENTITY_STATE } from '../ecs/columns';
import { hexDistance, hexIndex } from '../grid/hex';
import { sectorIndex } from '../grid/sectors';
import { setBlob, type PlanetState, type SimState } from '../kernel/state';

/**
 * Planet presence (D-39): who is where. One read model over the authoritative state for every consumer that needs
 * positions — the landing planner, the future AI orchestrator, dev tools — so none of them re-scans entity columns
 * with its own rules. Positions of live entities come from the entity store (persisted with every snapshot); the
 * landing history (`blobs.landingHistory`) remembers every landing ever made, also after a colony is gone.
 * Pure reads; the spatial index is rebuilt lazily when an entity column it reads changed (cheap: O(entities)).
 */

/** What an entity is for presence queries. A new kind registers its role (fauna kinds do when they land in the sim). */
export type PresenceRole = 'unit' | 'structure' | 'pod' | 'fauna' | 'other';

const ROLES = new Map<number, PresenceRole>([
  [ENTITY_KIND.devProbe, 'other'],
  [ENTITY_KIND.pod, 'pod'],
  [ENTITY_KIND.hq, 'unit'],
  [ENTITY_KIND.harvester, 'unit'],
  [ENTITY_KIND.builder, 'unit'],
  [ENTITY_KIND.terraformer, 'unit'],
  [ENTITY_KIND.hub, 'structure'],
]);

/** Registers the presence role of an entity kind (e.g. `registerPresenceRole(KIND_SKITTER, 'fauna')`). */
export function registerPresenceRole(kind: number, role: PresenceRole): void {
  const prev = ROLES.get(kind);
  if (prev && prev !== role) throw new Error(`entity kind ${kind} already has presence role ${prev}`);
  ROLES.set(kind, role);
}

export const presenceRoleOf = (kind: number): PresenceRole => ROLES.get(kind) ?? (kind >= ENTITY_KIND.hub ? 'structure' : 'other');

export interface EntityPos {
  id: number;
  kind: number;
  role: PresenceRole;
  /** Colony index, -1 for unowned (fauna, wild). */
  owner: number;
  q: number;
  r: number;
  /** Continuous position in tile units (where a moving unit is between tiles). */
  x: number;
  y: number;
  hp: number;
  state: number;
}

/** One landing ever made on this planet (append-only, `blobs.landingHistory`). */
export interface LandingRecord {
  colony: number;
  colonyId?: string;
  playerId?: string;
  q: number;
  r: number;
  tick: number;
  /** Spawn slot index when the landing used one. */
  slot?: number;
}

export interface ColonyPresence {
  colony: number;
  id?: string;
  playerId?: string;
  name?: string;
  status?: string;
  /** Where this colony landed (its first landing record). */
  landing?: LandingRecord;
  hq?: EntityPos;
  pods: EntityPos[];
  structures: EntityPos[];
  units: EntityPos[];
}

export interface PresenceView {
  tick: number;
  colonies: ColonyPresence[];
  fauna: EntityPos[];
  landings: LandingRecord[];
}

export const LANDING_HISTORY_BLOB = 'landingHistory';

/** Every landing ever made on the planet, oldest first. */
export function getLandingHistory(state: SimState): LandingRecord[] {
  const raw = state.blobs[LANDING_HISTORY_BLOB]?.value;
  return Array.isArray(raw) ? (raw as LandingRecord[]) : [];
}

/** A pod that has not touched down moved (dev.land): its colony's latest landing record follows it. */
export function relocateLanding(state: SimState, colony: number, q: number, r: number, tick: number): void {
  const hist = [...getLandingHistory(state)];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].colony !== colony) continue;
    hist[i] = { ...hist[i], q, r, tick };
    setBlob(state, LANDING_HISTORY_BLOB, hist, tick);
    return;
  }
}

/** Appends a landing to the history (the only writer; the landing system calls it once per landing). */
export function recordLanding(state: SimState, rec: LandingRecord, tick: number): void {
  setBlob(state, LANDING_HISTORY_BLOB, [...getLandingHistory(state), rec], tick);
}

const alive = (s: SimState, row: number) => !(s.entities.cols.hpMax[row] > 0 && s.entities.cols.hp[row] <= 0);

function posOf(s: SimState, row: number): EntityPos {
  const c = s.entities.cols;
  return { id: c.id[row], kind: c.kind[row], role: presenceRoleOf(c.kind[row]), owner: c.owner[row], q: c.q[row], r: c.r[row], x: c.x[row], y: c.y[row], hp: c.hp[row], state: c.state[row] };
}

/** Entity columns a presence answer depends on (`posOf` + `alive`). */
const KEY_COLS = ['id', 'kind', 'owner', 'q', 'r', 'x', 'y', 'hp', 'hpMax', 'state'] as const;
type KeyCol = (typeof KEY_COLS)[number];

/**
 * Sector buckets of live entities, keyed on the entity store, plus a copy of the columns they were built from. The
 * index is reused only while those columns are value-for-value identical (WE-22): a write in the same tick as the
 * newest `changedAt` (a move, a death) or one that skips the stamp still triggers a rebuild. The compare is
 * O(entities × 10), far cheaper than the rebuild.
 */
interface SpatialIndex {
  count: number;
  seen: Record<KeyCol, ArrayLike<number>>;
  bySector: Map<number, EntityPos[]>;
  all: EntityPos[];
}
const indexes = new WeakMap<object, SpatialIndex>();

function unchanged(idx: SpatialIndex, s: SimState): boolean {
  const n = s.entities.count;
  if (idx.count !== n) return false;
  const c = s.entities.cols;
  for (const k of KEY_COLS) {
    const a = idx.seen[k], b = c[k];
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  }
  return true;
}

function copyKeyCols(s: SimState): Record<KeyCol, ArrayLike<number>> {
  const n = s.entities.count, c = s.entities.cols;
  return Object.fromEntries(KEY_COLS.map((k) => [k, c[k].slice(0, n)])) as unknown as Record<KeyCol, ArrayLike<number>>;
}

function spatial(s: SimState): SpatialIndex {
  const hit = indexes.get(s.entities);
  if (hit && unchanged(hit, s)) return hit;
  const hex = hexIndex(s.grid.radius), sec = sectorIndex(s.grid.radius);
  const bySector = new Map<number, EntityPos[]>();
  const all: EntityPos[] = [];
  for (let row = 0; row < s.entities.count; row++) {
    if (!alive(s, row)) continue;
    const p = posOf(s, row);
    all.push(p);
    const t = hex.indexOf(p.q, p.r);
    if (t < 0) continue;
    const id = sec.sectorOfTile[t];
    const list = bySector.get(id);
    if (list) list.push(p); else bySector.set(id, [p]);
  }
  const idx: SpatialIndex = { count: s.entities.count, seen: copyKeyCols(s), bySector, all };
  indexes.set(s.entities, idx);
  return idx;
}

/** Live entities within hex distance `radius` of (q, r), nearest first (ties by id); quadtree walk over sectors. */
export function entitiesNear(s: SimState, q: number, r: number, radius: number, filter?: (e: EntityPos) => boolean): EntityPos[] {
  const idx = spatial(s);
  const out: Array<{ e: EntityPos; d: number }> = [];
  for (const sid of sectorIndex(s.grid.radius).near(q, r, radius)) {
    for (const e of idx.bySector.get(sid) ?? []) {
      const d = hexDistance(q, r, e.q, e.r);
      if (d <= radius && (!filter || filter(e))) out.push({ e, d });
    }
  }
  return out.sort((a, b) => a.d - b.d || a.e.id - b.e.id).map((o) => o.e);
}

/** The nearest live entity matching `filter` within `maxRadius` (default: the whole planet), or null. */
export function nearestEntity(s: SimState, q: number, r: number, filter: (e: EntityPos) => boolean, maxRadius = s.grid.radius * 2): EntityPos | null {
  return entitiesNear(s, q, r, maxRadius, filter)[0] ?? null;
}

/** Every live fauna entity (unowned, role `fauna`). */
export const faunaPositions = (s: SimState): EntityPos[] => spatial(s).all.filter((e) => e.role === 'fauna');

/** Per-colony presence: landing record, HQ, pods, structures and units, in colony index order. */
export function colonyPresence(s: SimState): ColonyPresence[] {
  const byColony = new Map<number, ColonyPresence>();
  const get = (i: number): ColonyPresence => {
    let p = byColony.get(i);
    if (!p) {
      const col = s.colonies[i];
      p = {
        colony: i,
        ...(col?.id ? { id: col.id } : {}),
        ...(typeof col?.playerId === 'string' ? { playerId: col.playerId } : {}),
        ...(col?.name ? { name: col.name } : {}),
        ...(col?.status ? { status: col.status } : {}),
        pods: [], structures: [], units: [],
      };
      byColony.set(i, p);
    }
    return p;
  };
  for (const c of s.colonies) if (c) get(c.index);
  for (const rec of getLandingHistory(s)) { const p = get(rec.colony); if (!p.landing) p.landing = rec; }
  for (const e of spatial(s).all) {
    if (e.owner < 0) continue;
    const p = get(e.owner);
    if (e.role === 'pod') p.pods.push(e);
    else if (e.role === 'structure') p.structures.push(e);
    else if (e.role === 'unit') {
      p.units.push(e);
      if (e.kind === ENTITY_KIND.hq && e.state !== ENTITY_STATE.descending && !p.hq) p.hq = e;
    }
  }
  return [...byColony.values()].sort((a, b) => a.colony - b.colony);
}

/**
 * The whole presence read model as plain data (JSON-safe): what an AI orchestrator, a dev route or a test reads.
 * Host-side: built from the authoritative state, so it never contains hidden ground.
 */
export function presenceView(s: PlanetState): PresenceView {
  return { tick: s.meta.tick, colonies: colonyPresence(s), fauna: faunaPositions(s), landings: getLandingHistory(s) };
}
