import {
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
    out.push({ id: e.id, kind: e.kind, owner: e.owner, q: e.q, r: e.r, hp: e.hp, hpMax: e.hpMax, state: e.state });
  });
  return out;
}

/** Hex radius of a planet with `count` tiles (`count = 3r(r + 1) + 1`). */
function radiusOfTileCount(count: number): number {
  return count > 0 ? Math.round((Math.sqrt(12 * count - 3) - 3) / 6) : 0;
}

/** Adapts any world source (authoritative state, replica view, local host view) into the shared `PlacementWorld`. */
export function viewPlacementWorld(source: WorldSource, fallbackTiles?: ClientTiles | null): PlacementWorld {
  if (isPlanetState(source)) return placementWorldFromState(source);
  const v = (source ?? {}) as {
    planet?: { radius?: number };
    tiles?: ClientTiles;
    entities?: Float32Array | ViewEntity[];
    count?: number;
  };
  const tiles = v.tiles ?? fallbackTiles ?? null;
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
  };
}

