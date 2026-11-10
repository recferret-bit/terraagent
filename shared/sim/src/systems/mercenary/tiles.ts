import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import type { PlanetState } from '../../kernel/state';
import { findColonyEntityRow } from '../find';

/** Free tiles on the poster's hub edge, nearest ring first. Null when the poster has no living hub or HQ. */
export function hubEdgeTiles(state: PlanetState, poster: number, count: number): { q: number; r: number }[] | null {
  const hub = findPosterHub(state, poster);
  if (hub < 0) return null;
  const cols = state.entities.cols;
  const originQ = cols.q[hub]!;
  const originR = cols.r[hub]!;
  const idx = hexIndex(state.grid.radius);
  const taken = occupiedTiles(state, idx);
  const out: { q: number; r: number }[] = [];
  for (let dist = 1; dist <= 3 && out.length < count; dist++) {
    for (const tile of ring(originQ, originR, dist)) {
      const at = idx.indexOf(tile.q, tile.r);
      if (at < 0 || taken.has(at) || !standable(state, at)) continue;
      taken.add(at);
      out.push(tile);
      if (out.length === count) break;
    }
  }
  return out;
}

function findPosterHub(state: PlanetState, poster: number): number {
  const linked = state.colonies[poster]?.hubEntityId;
  if (typeof linked === 'number') {
    const row = rowOf(state.entities, linked);
    if (row >= 0 && state.entities.cols.hp[row]! > 0) return row;
  }
  const hub = findColonyEntityRow(state, poster, ENTITY_KIND.hub);
  if (hub >= 0) return hub;
  return findColonyEntityRow(state, poster, ENTITY_KIND.hq);
}

function occupiedTiles(state: PlanetState, idx: ReturnType<typeof hexIndex>): Set<number> {
  const taken = new Set<number>();
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.hp[row]! <= 0) continue;
    const at = idx.indexOf(cols.q[row]!, cols.r[row]!);
    if (at >= 0) taken.add(at);
  }
  return taken;
}

function standable(state: PlanetState, tile: number): boolean {
  const layers = state.grid.layers;
  if (layers.terrain[tile] === TERRAIN.deep || layers.terrain[tile] === TERRAIN.hole) return false;
  return layers.prep[tile] !== PREP.ridge && layers.prep[tile] !== PREP.moat;
}

function ring(q: number, r: number, dist: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let dr = -dist; dr <= dist; dr++) {
    for (let dq = -dist; dq <= dist; dq++) {
      if (hexDistance(0, 0, dq, dr) === dist) out.push({ q: q + dq, r: r + dr });
    }
  }
  return out;
}
