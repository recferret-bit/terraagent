import { describe, expect, it } from 'vitest';
import {
  ENTITY_KIND,
  checkGridTileExplored,
  createState,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  recordColonyTileExplored,
  setTileOwner,
  type PlanetState,
  type TileLayersLike,
} from '@terra/sim';
import { screenTarget } from './target.js';
import { HOUR_MS, activeScreen, bountyPolicy, expiryScreen } from './validate.js';

const NOW = 1_700_000_000_000;

describe('bounty post validators', () => {
  it('reads the 3-active and 2–48 h policy', () => {
    expect(bountyPolicy()).toEqual({ maxActive: 3, expiryMinMs: 2 * HOUR_MS, expiryMaxMs: 48 * HOUR_MS });
  });

  it('accepts an expiry on the 2 h and 48 h edges and rejects outside them', () => {
    const policy = bountyPolicy();
    expect(expiryScreen(NOW + policy.expiryMinMs, NOW)).toBeNull();
    expect(expiryScreen(NOW + policy.expiryMaxMs, NOW)).toBeNull();
    expect(expiryScreen(NOW + HOUR_MS, NOW)?.code).toBe('invalid_args');
    expect(expiryScreen(NOW + policy.expiryMinMs - 1, NOW)?.code).toBe('invalid_args');
    expect(expiryScreen(NOW + policy.expiryMaxMs + 1, NOW)?.code).toBe('invalid_args');
  });

  it('rejects a fourth active bounty and allows fewer', () => {
    expect(activeScreen(0)).toBeNull();
    expect(activeScreen(2)).toBeNull();
    expect(activeScreen(3)?.code).toBe('queue_full');
    expect(activeScreen(4)?.code).toBe('queue_full');
  });
});

describe('bounty target visibility', () => {
  it('accepts an explored living hive and rejects a hidden, missing, or dead one', () => {
    const state = createState({ planetId: 'pl_bounty', planetType: 'temperate', seed: 'bounty', radius: 8 });
    const seen = hive(state, 3, -1);
    const hidden = hive(state, 5, 1);
    const dead = hive(state, 2, 2, 0);
    explore(state, 3, -1);
    expect(screenTarget(state, 0, { kind: 'clear_nest', nestId: String(seen) })).toBeNull();
    expect(screenTarget(state, 0, { kind: 'clear_nest', nestId: String(hidden) })?.code).toBe('invalid_target');
    expect(screenTarget(state, 0, { kind: 'clear_nest', nestId: String(dead) })?.code).toBe('invalid_target');
    expect(screenTarget(state, 0, { kind: 'clear_nest', nestId: '99999' })?.code).toBe('invalid_target');
    expect(screenTarget(null, 0, { kind: 'clear_nest', nestId: String(seen) })?.code).toBe('invalid_target');
    expect(checkGridTileExplored(layers(state), state.grid.count, hexIndex(state.grid.radius).indexOf(3, -1), 0)).toBe(true);
  });

  it('requires the defend tile to be the poster colony territory', () => {
    const state = createState({ planetId: 'pl_area', planetType: 'temperate', seed: 'area', radius: 8 });
    const tile = hexIndex(state.grid.radius).indexOf(1, 1);
    setTileOwner(state.grid, tile, 0, state.meta.tick);
    expect(screenTarget(state, 0, { kind: 'defend_area', q: 1, r: 1, radius: 2, durationH: 2 })).toBeNull();
    expect(screenTarget(state, 1, { kind: 'defend_area', q: 1, r: 1, radius: 2, durationH: 2 })?.code).toBe('not_own_territory');
    expect(screenTarget(null, 0, { kind: 'defend_area', q: 1, r: 1, radius: 1, durationH: 2 })?.code).toBe('not_own_territory');
  });

  it('accepts a Tier-1 delivery and rejects a non-positive amount', () => {
    expect(screenTarget(null, 0, { kind: 'deliver_units', resource: 'bio.water', amount: 1 })).toBeNull();
    expect(screenTarget(null, 0, { kind: 'deliver_units', resource: 'metals.t1', amount: 0 })?.code).toBe('invalid_args');
  });
});

function hive(state: PlanetState, q: number, r: number, hp = 100): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = ENTITY_KIND.hiveBlackAnt;
  state.entities.cols.hp[row] = hp;
  state.entities.cols.hpMax[row] = 100;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}

function explore(state: PlanetState, q: number, r: number): void {
  const tile = hexIndex(state.grid.radius).indexOf(q, r);
  recordColonyTileExplored(layers(state), state.grid.count, tile, 0, state.meta.tick, state.meta, state.blobs);
}

function layers(state: PlanetState): TileLayersLike {
  return state.grid.layers as TileLayersLike;
}
