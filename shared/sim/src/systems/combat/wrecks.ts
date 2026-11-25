import { ENTITY_KIND } from '../../ecs/columns';
import { hexIndex } from '../../grid/hex';
import { bumpPathEpoch } from '../../grid/tileModel';
import { setBlob, type PlanetState, type SimState } from '../../kernel/state';

export interface SimWreckEntry {
  id: number;
  kind: number;
  owner: number;
  q: number;
  r: number;
  tiles: number[];
  createdAt: number;
}

export interface SimWrecksBlob {
  byId: Record<string, SimWreckEntry>;
}

const NON_WRECK_KINDS = new Set<number>([
  ENTITY_KIND.pod,
  ENTITY_KIND.devProbe,
  ENTITY_KIND.blackAnt,
  ENTITY_KIND.blueBeetle,
  ENTITY_KIND.greenSpitter,
  ENTITY_KIND.hiveBlackAnt,
  ENTITY_KIND.hiveBlueBeetle,
  ENTITY_KIND.hiveGreenSpitter,
]);

/** Whether a destroyed entity kind leaves a solid mechanical wreck requiring terraform. */
export function isMechanicalWreckKind(kind: number): boolean {
  return !NON_WRECK_KINDS.has(kind);
}

function unwrapWrecksBlob(source: SimState | { blobs?: Record<string, unknown> } | Record<string, unknown> | undefined | null): SimWrecksBlob | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const root = 'blobs' in source && source.blobs && typeof source.blobs === 'object'
    ? (source.blobs as Record<string, unknown>)
    : (source as Record<string, unknown>);
  const raw = 'wrecks' in root ? root.wrecks : ('byId' in root ? root : undefined);
  if (!raw || typeof raw !== 'object') return undefined;
  const unwrapped = 'value' in raw && raw.value && typeof raw.value === 'object'
    ? (raw.value as SimWrecksBlob)
    : (raw as SimWrecksBlob);
  return unwrapped?.byId && typeof unwrapped.byId === 'object' ? unwrapped : undefined;
}

export function getWrecksMap(source: SimState | { blobs?: Record<string, unknown> } | Record<string, unknown> | undefined | null): Readonly<Record<string, SimWreckEntry>> {
  return unwrapWrecksBlob(source)?.byId ?? {};
}

export function getWreckTileSet(source: SimState | { blobs?: Record<string, unknown> } | Record<string, unknown> | undefined | null): Set<number> {
  const out = new Set<number>();
  for (const entry of Object.values(getWrecksMap(source))) {
    if (!entry || !Array.isArray(entry.tiles)) continue;
    for (const ti of entry.tiles) {
      if (Number.isInteger(ti) && ti >= 0) out.add(ti);
    }
  }
  return out;
}

export function findWreckAtTile(
  source: SimState | { blobs?: Record<string, unknown> } | Record<string, unknown> | undefined | null,
  tileIdx: number,
): SimWreckEntry | undefined {
  if (tileIdx < 0) return undefined;
  for (const entry of Object.values(getWrecksMap(source))) {
    if (entry?.tiles?.includes(tileIdx)) return entry;
  }
  return undefined;
}

export function getWreckGroupCoords(
  radius: number,
  source: SimState | { blobs?: Record<string, unknown> } | Record<string, unknown> | undefined | null,
  tileIdx: number,
): Array<{ q: number; r: number }> {
  if (radius <= 0 || tileIdx < 0) return [];
  const hx = hexIndex(radius);
  const out = new Map<number, { q: number; r: number }>();
  for (const entry of Object.values(getWrecksMap(source))) {
    if (!entry?.tiles?.includes(tileIdx)) continue;
    for (const ti of entry.tiles) {
      if (!Number.isInteger(ti) || ti < 0 || ti >= hx.count) continue;
      const q = hx.q[ti];
      const r = hx.r[ti];
      if (q !== undefined && r !== undefined) out.set(ti, { q, r });
    }
  }
  return [...out.values()];
}

export function getWreckGroupMap(
  radius: number,
  source: SimState | { blobs?: Record<string, unknown> } | Record<string, unknown> | undefined | null,
): Map<number, ReadonlyArray<{ q: number; r: number }>> {
  const map = new Map<number, ReadonlyArray<{ q: number; r: number }>>();
  if (radius <= 0) return map;
  const hx = hexIndex(radius);
  for (const entry of Object.values(getWrecksMap(source))) {
    if (!entry || !Array.isArray(entry.tiles) || entry.tiles.length === 0) continue;
    const coords: Array<{ q: number; r: number }> = [];
    for (const ti of entry.tiles) {
      if (!Number.isInteger(ti) || ti < 0 || ti >= hx.count) continue;
      const q = hx.q[ti];
      const r = hx.r[ti];
      if (q !== undefined && r !== undefined) coords.push({ q, r });
    }
    if (coords.length === 0) continue;
    for (const ti of entry.tiles) {
      const prev = map.get(ti);
      if (!prev) {
        map.set(ti, coords);
      } else {
        const merged = new Map<string, { q: number; r: number }>();
        for (const c of prev) merged.set(`${c.q},${c.r}`, c);
        for (const c of coords) merged.set(`${c.q},${c.r}`, c);
        map.set(ti, [...merged.values()]);
      }
    }
  }
  return map;
}

export function recordMechanicalWreck(
  state: PlanetState,
  opts: { id: number; kind: number; owner: number; q: number; r: number; tiles: readonly number[] },
  tick: number = state.meta.tick,
): SimWreckEntry | null {
  if (!isMechanicalWreckKind(opts.kind)) return null;
  const idx = hexIndex(state.grid.radius);
  const aq = Math.round(opts.q);
  const ar = Math.round(opts.r);
  const uniqueTiles: number[] = [];
  const seen = new Set<number>();
  for (const ti of opts.tiles) {
    if (Number.isInteger(ti) && ti >= 0 && ti < state.grid.count && !seen.has(ti)) {
      seen.add(ti);
      uniqueTiles.push(ti);
    }
  }
  if (uniqueTiles.length === 0) {
    const anchorIdx = idx.indexOf(aq, ar);
    if (anchorIdx >= 0 && anchorIdx < state.grid.count) uniqueTiles.push(anchorIdx);
  }
  if (uniqueTiles.length === 0) return null;

  const byId: Record<string, SimWreckEntry> = { ...getWrecksMap(state) };
  const entry: SimWreckEntry = {
    id: opts.id,
    kind: opts.kind,
    owner: opts.owner,
    q: aq,
    r: ar,
    tiles: uniqueTiles,
    createdAt: tick,
  };
  byId[String(opts.id)] = entry;
  setBlob(state, 'wrecks', { byId } satisfies SimWrecksBlob, tick);
  bumpPathEpoch(state.meta);
  return entry;
}

export function clearWrecksAtTile(
  state: PlanetState,
  tileIdx: number,
  tick: number = state.meta.tick,
): { removed: SimWreckEntry[]; clearedTiles: number[] } {
  const existing = getWrecksMap(state);
  const next: Record<string, SimWreckEntry> = {};
  const removed: SimWreckEntry[] = [];
  const clearedSet = new Set<number>();
  for (const [key, entry] of Object.entries(existing)) {
    if (entry?.tiles?.includes(tileIdx)) {
      removed.push(entry);
      for (const ti of entry.tiles) clearedSet.add(ti);
    } else if (entry) {
      next[key] = entry;
    }
  }
  if (removed.length > 0) {
    setBlob(state, 'wrecks', { byId: next } satisfies SimWrecksBlob, tick);
    bumpPathEpoch(state.meta);
  }
  return { removed, clearedTiles: [...clearedSet] };
}
