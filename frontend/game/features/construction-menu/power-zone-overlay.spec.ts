import { parseWaves } from '@terra/contracts';
import { compileData, ENTITY_KIND, ENTITY_STATE, type ViewEntity } from '@terra/sim';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameView } from '../../core/registry/types';
import type { Scene3dService } from '../shared/scene3d';
import { PowerZoneOverlay3D } from './powerZoneOverlay';

const DATA = compileData(parseWaves('..03'));
const ent = (id: number, kind: number, q: number, r: number): ViewEntity =>
  ({ id, kind, owner: 0, q, r, hp: 100, hpMax: 100, state: ENTITY_STATE.idle }) as unknown as ViewEntity;
const viewOf = (entities: ViewEntity[]): GameView =>
  ({ planet: { id: 'p', type: 'temperate', radius: 20 }, entities, count: entities.length }) as unknown as GameView;

function overlay() {
  const s3: Scene3dService = {
    scene: new THREE.Scene(),
    tileToWorld: (q, r) => ({ x: (q + r / 2) * 1.5, y: 0, z: r * 1.3 }),
    biomeKey: () => 'temperate',
  };
  const o = new PowerZoneOverlay3D(s3);
  const [fill, edge] = o.group.children as THREE.Mesh[];
  const verts = (m: THREE.Mesh) => m.geometry.getAttribute('position')?.count ?? 0;
  return { o, fill, edge, verts };
}

describe('power zone overlay (construction ghost armed)', () => {
  it('draws the Hub zone (radius 6: 127 tiles) as one fill and one outline ribbon, hidden when no ghost is armed', () => {
    const { o, fill, edge, verts } = overlay();
    const view = viewOf([ent(1, ENTITY_KIND.commandHub, 0, 0)]);
    o.update(view, false, 0, DATA, 0.016);
    expect(o.group.visible).toBe(false);
    o.update(view, true, 0, DATA, 0.016);
    expect(o.group.visible).toBe(true);
    expect(verts(fill)).toBe(127 * 6 * 3); // 6 triangles per hex
    expect(verts(edge)).toBe(6 * 13 * 6); // a radius-6 hex disk has 6 * (2 * 6 + 1) outline sides, 2 triangles each
  });

  it('rebuilds only when a source changes (a pylon extends the zone), not every frame', () => {
    const { o, fill, verts } = overlay();
    o.update(viewOf([ent(1, ENTITY_KIND.commandHub, 0, 0)]), true, 0, DATA, 0.016);
    const geo = fill.geometry;
    o.update(viewOf([ent(1, ENTITY_KIND.commandHub, 0, 0)]), true, 0, DATA, 0.016);
    expect(fill.geometry).toBe(geo);
    o.update(viewOf([ent(1, ENTITY_KIND.commandHub, 0, 0), ent(2, ENTITY_KIND.pylon, 6, 0)]), true, 0, DATA, 0.016);
    expect(fill.geometry).not.toBe(geo);
    expect(verts(fill)).toBeGreaterThan(127 * 18);
  });

  it('shows nothing for a colony without a Hub or pylon', () => {
    const { o } = overlay();
    o.update(viewOf([]), true, 0, DATA, 0.016);
    expect(o.group.visible).toBe(false);
  });
});
