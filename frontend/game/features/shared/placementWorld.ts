import {
  plannedSitesFromQueue,
  placementWorldFromState,
  type PlacementEntity,
  type PlacementWorld,
  type PlanetState,
  type SimView,
  type ViewEntity,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { forEachEntity, type ClientTiles, type ClientView } from '../../store/replica/viewCodec';

/** Anything a feature evaluates sim rules on: authoritative state (tests / tools) or a client / sim view. */
export type WorldSource = PlanetState | ClientView | SimView | GameView | null | undefined;

export function isPlanetState(src: unknown): src is PlanetState {
  return Boolean(
    src &&
      typeof src === 'object' &&
      'grid' in src &&
      typeof (src as PlanetState).grid?.radius === 'number' &&
      (src as PlanetState).grid?.layers,
  );
}

function entitiesFromView(rawEntities: Float32Array | ViewEntity[] | undefined, rawCount?: number): PlacementEntity[] {
  const out: PlacementEntity[] = [];
  forEachEntity(rawEntities, rawCount, (e) => {
    out.push({ id: e.id, kind: e.kind, owner: e.owner, q: e.q, r: e.r, hp: e.hp, hpMax: e.hpMax, state: e.state, ...(e.tier > 0 ? { tier: e.tier } : {}) });
  });
  return out;
}

/** The host's per-colony best worker tier (`ViewColony.maxWorkerTier`), what `colonyMaxWorkerTier` reads on the client. */
function maxWorkerTierByColony(colonies: unknown): Record<number, number> | undefined {
  if (!Array.isArray(colonies)) return undefined;
  const out: Record<number, number> = {};
  colonies.forEach((c: { index?: number; maxWorkerTier?: number } | null, i) => {
    if (c && typeof c.maxWorkerTier === 'number') out[typeof c.index === 'number' ? c.index : i] = c.maxWorkerTier;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Hex radius of a planet with `count` tiles (`count = 3r(r + 1) + 1`). */
function radiusOfTileCount(count: number): number {
  return count > 0 ? Math.round((Math.sqrt(12 * count - 3) - 3) / 6) : 0;
}

/** An open queue entry as the client reads it from a view (build orders carry their site). */
export interface ViewQueueEntry {
  colonyIndex?: number;
  state?: string;
  task?: { kind?: string; building?: string; q?: number; r?: number; rotation?: number };
}

/** Every seat's open queue entries in a view (its colonies' construction queues, else the raw `queue` blob). */
export function viewQueueEntries(source: unknown): ViewQueueEntry[] {
  const v = (source ?? {}) as {
    colonies?: Array<{ index?: number; queue?: ViewQueueEntry[]; constructionQueue?: ViewQueueEntry[] } | null>;
    blobs?: { queue?: { entries?: ViewQueueEntry[]; value?: { entries?: ViewQueueEntry[] } } };
  };
  const fromColonies = (v.colonies ?? []).flatMap((c) =>
    (c?.constructionQueue ?? c?.queue ?? []).map((e) => (e.colonyIndex === undefined && typeof c?.index === 'number' ? { ...e, colonyIndex: c.index } : e)),
  );
  return fromColonies.length > 0 ? fromColonies : v.blobs?.queue?.entries ?? v.blobs?.queue?.value?.entries ?? [];
}

/** Adapts any world source (authoritative state, replica view, local host view) into the shared `PlacementWorld`. */
export function viewPlacementWorld(source: WorldSource, fallbackTiles?: ClientTiles | null): PlacementWorld {
  if (isPlanetState(source)) return placementWorldFromState(source);
  const v = (source ?? {}) as {
    planet?: { radius?: number };
    tiles?: ClientTiles;
    entities?: Float32Array | ViewEntity[];
    count?: number;
    colonies?: unknown;
  };
  const tiles = v.tiles ?? fallbackTiles ?? null;
  const tiers = maxWorkerTierByColony(v.colonies);
  const complete = Boolean(tiles?.terrain && tiles.prep && tiles.owner);
  return {
    radius: typeof v.planet?.radius === 'number' ? v.planet.radius : radiusOfTileCount(tiles?.count ?? 0),
    tileCount: complete ? tiles!.count : 0,
    terrain: tiles?.terrain ?? new Uint8Array(0),
    prep: tiles?.prep ?? new Uint8Array(0),
    deposit: tiles?.deposit ?? null,
    owner: tiles?.owner ?? new Int8Array(0),
    height: tiles?.height ?? null,
    entities: entitiesFromView(v.entities, v.count),
    plannedSites: plannedSitesFromQueue(viewQueueEntries(source)),
    ...(tiers ? { maxWorkerTierByColony: tiers } : {}),
  };
}

