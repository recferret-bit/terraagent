// @vitest-environment jsdom
import { compileData, ENTITY_KIND, hexCount, hexIndex } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { ghostData } from './ghostContext';
import { PlacementGhostController } from './PlacementGhost';

const FLAGS = new Set(['W00', 'W01', 'W02']);

describe('ghostData: the ghost judges with one compiled data set', () => {
  it('compiles once per flag set, and prefers the replica data (planet balance overrides, D-35)', () => {
    expect(ghostData(new Set(FLAGS))).toBe(ghostData(new Set(FLAGS)));
    const replica = compileData(FLAGS);
    expect(ghostData(FLAGS, { simData: () => replica })).toBe(replica);
  });
});

describe('auto-site search (a card click with the pointer off a valid site)', () => {
  it('searches around the own HQ, not the planet origin: a colony 15 hexes out still gets a green site', () => {
    const radius = 16, count = hexCount(radius), idx = hexIndex(radius);
    const owner = new Int8Array(count).fill(1); // colony 1's ground everywhere but around colony 0's HQ
    const hq = { q: 15, r: -2 }; // every own tile is 12+ hexes from the origin
    for (let r = -radius; r <= radius; r++) {
      for (let q = -radius; q <= radius; q++) {
        const i = idx.indexOf(q, r);
        if (i >= 0 && Math.max(Math.abs(q - hq.q), Math.abs(r - hq.r), Math.abs(q + r - hq.q - hq.r)) <= 3) owner[i] = 0;
      }
    }
    const view = {
      planet: { id: 'p', type: 'desert', radius },
      tiles: { count, terrain: new Uint8Array(count), prep: new Uint8Array(count), deposit: new Uint8Array(count), height: new Float32Array(count), owner },
      entities: [{ id: 7, kind: ENTITY_KIND.hq, owner: 0, q: hq.q, r: hq.r, x: hq.q, y: hq.r, hp: 100, hpMax: 100, state: 0 }],
      count: 1,
      colonies: [{ index: 0 }],
    } as unknown as GameView;
    const ctx = { flags: FLAGS, host: 'server', services: { sendCommand: vi.fn(), track: vi.fn() } } as unknown as FeatureContext;
    const ghost = new PlacementGhostController({ ctx, initialView: view });
    ghost.start('solar');
    const st = ghost.getState()!;
    expect(st.valid).toBe(true);
    expect(Math.max(Math.abs(st.q - hq.q), Math.abs(st.r - hq.r))).toBeLessThanOrEqual(3);
    ghost.dispose();
  });
});
