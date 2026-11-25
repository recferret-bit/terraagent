// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  HEX_WATER_LEVEL,
  tileXZ,
  type HexTerrain,
} from '@terra/render/planets/hex';
import {
  RING_SEGMENTS,
  RING_Y_OFFSET,
} from '@terra/render/visuals/rings';
import { ENTITY_KIND, hexCount, indexOf, TERRAIN } from '@terra/sim';
import type { FeatureContext, GameView } from '../../../core/registry';
import {
  createRangeRingsRenderer,
  RING_ENTITY_KIND,
} from '../index';

function makeContext(overrides?: Partial<FeatureContext['services']>): FeatureContext {
  const scene = new THREE.Scene();
  const flags = new Set(parseWaves('..07').list);
  return {
    flags,
    host: 'local',
    services: {
      track: () => undefined,
      scene3d: {
        scene,
        tileToWorld(x: number, y: number) {
          const [wx, wz] = tileXZ(x, y);
          return { x: wx, y: 0, z: wz };
        },
        biomeKey: () => 'forestRock',
      },
      ...overrides,
    },
  };
}

describe('W07-21 2-ring invariant & terrain draping', () => {
  it('enforces max 2 circles for combat units and 1 sight circle for non-combat units', () => {
    const ctx = makeContext();
    const renderer = createRangeRingsRenderer(ctx);
    const combatKinds = [
      ENTITY_KIND.hq,
      ENTITY_KIND.recon,
      RING_ENTITY_KIND.demoTank,
      RING_ENTITY_KIND.demoArtillery,
      ENTITY_KIND.autocannon,
      ENTITY_KIND.laserTower,
    ];
    for (let i = 0; i < combatKinds.length; i++) {
      const id = 300 + i;
      renderer.setSelectedEntityIds([id]);
      renderer.update({ entities: [{ id, kind: combatKinds[i]!, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 200 }] });
      const active = renderer.getActiveRings();
      expect(active.map((r) => r.kind).sort()).toEqual(['viewRange', 'weapon']);
      expect(active[0]!.colorHex).not.toBe(active[1]!.colorHex);
    }
    const nonCombatKinds = [ENTITY_KIND.worker, ENTITY_KIND.commandHub, RING_ENTITY_KIND.outpostBeacon];
    for (let i = 0; i < nonCombatKinds.length; i++) {
      const id = 400 + i;
      renderer.setSelectedEntityIds([id]);
      renderer.update({ entities: [{ id, kind: nonCombatKinds[i]!, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 200 }] });
      expect(renderer.getActiveRings().map((r) => r.kind)).toEqual(['viewRange']);
    }
    renderer.dispose();
  });

  it('drapes rings across non-flat terrain heights, clamps lake water tiles, and refreshes on terrain tile updates', () => {
    let bump = 0;
    const terrainFn = (wx: number, wz: number) =>
      2.4 * Math.sin(wx * 0.16) + 1.5 * Math.cos(wz * 0.14) + bump;
    const radius = 16;
    const terrainArr = new Uint8Array(hexCount(radius));
    terrainArr.fill(TERRAIN.slope);
    // Mark a lake sector around +X perimeter of the 14-tile (28m) ring so cos(0) clamps above water level.
    const lakeIdx = indexOf(radius, 14, 0);
    if (lakeIdx >= 0) terrainArr[lakeIdx] = TERRAIN.deep;

    const ctx = makeContext({
      hexTerrain: { heightAt: terrainFn } as unknown as HexTerrain,
    });
    const renderer = createRangeRingsRenderer(ctx);
    const ent = { id: 501, kind: RING_ENTITY_KIND.demoArtillery, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 200 };
    renderer.setSelectedEntityIds([501]);
    const count = terrainArr.length;
    const prep = new Uint8Array(count);
    const owner = new Int16Array(count);
    renderer.update({
      planet: { id: 'p-dune', type: 'dune', radius },
      tiles: { count, terrain: terrainArr, prep, owner },
      entities: [ent],
    });

    const weaponRing = renderer.getActiveRings()[0]!;
    expect(weaponRing.kind).toBe('weapon');
    for (const seg of [32, 64, 96]) {
      const theta = (seg / RING_SEGMENTS) * Math.PI * 2;
      const sx = weaponRing.worldX + Math.cos(theta) * weaponRing.radiusMeters;
      const sz = weaponRing.worldZ + Math.sin(theta) * weaponRing.radiusMeters;
      expect(renderer.rings.sampleEncodedHeight(0, seg)).toBeCloseTo(terrainFn(sx, sz) + RING_Y_OFFSET, 1);
    }
    // Perimeter segment 0 sits over tile (14, 0) marked deep water -> clamped to >= HEX_WATER_LEVEL + RING_Y_OFFSET.
    expect(renderer.rings.sampleEncodedHeight(0, 0)).toBeGreaterThanOrEqual(HEX_WATER_LEVEL + RING_Y_OFFSET - 0.01);

    // Terraforming update (new tiles reference) triggers re-sampling even without unit movement.
    bump = 3.0;
    const updatedTerrain = new Uint8Array(terrainArr);
    renderer.update({
      planet: { id: 'p-dune', type: 'dune', radius },
      tiles: { count, terrain: updatedTerrain, prep, owner },
      entities: [ent],
    });
    const theta64 = (64 / RING_SEGMENTS) * Math.PI * 2;
    const sx64 = weaponRing.worldX + Math.cos(theta64) * weaponRing.radiusMeters;
    const sz64 = weaponRing.worldZ + Math.sin(theta64) * weaponRing.radiusMeters;
    expect(renderer.rings.sampleEncodedHeight(0, 64)).toBeCloseTo(terrainFn(sx64, sz64) + RING_Y_OFFSET, 1);
    renderer.dispose();
  });
});

describe('W07-21 range ring labels & legend clarity', () => {
  it('displays clear FIRING RANGE and SIGHT labels and hides cleanly on deselection', () => {
    const hudOverlay = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, x: 0, y: 0, toJSON: () => ({}),
    });
    const camera = new THREE.PerspectiveCamera(28, 1280 / 720, 0.1, 400);
    camera.position.set(0, 46, 46);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const ctx = makeContext({ hudOverlay, canvas, camera });
    const renderer = createRangeRingsRenderer(ctx);
    const view: GameView = {
      entities: [
        { id: 601, kind: RING_ENTITY_KIND.demoArtillery, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 200 },
        { id: 602, kind: ENTITY_KIND.worker, owner: 0, q: 1, r: 0, x: 1, y: 0, hp: 160 },
      ],
    };

    // Single artillery with active camera -> crisp on-ring badges
    renderer.setSelectedEntityIds([601]);
    renderer.update(view);
    const weaponTag = hudOverlay.querySelector('[data-testid="range-ring-tag-weapon"]');
    const sightTag = hudOverlay.querySelector('[data-testid="range-ring-tag-viewRange"]');
    expect(weaponTag?.textContent).toBe('FIRING RANGE · 14');
    expect(sightTag?.textContent).toBe('SIGHT · 6');

    // Non-combat worker -> only Sight badge
    renderer.setSelectedEntityIds([602]);
    renderer.update(view);
    expect(hudOverlay.querySelector('[data-testid="range-ring-tag-weapon"]')).toBeNull();
    expect(hudOverlay.querySelector('[data-testid="range-ring-tag-viewRange"]')?.textContent).toContain('SIGHT');

    // Alt multi-unit view -> compact legend strip without per-ring clutter
    renderer.setSelectedEntityIds([]);
    renderer.setAltPressed(true);
    renderer.update(view);
    const legend = hudOverlay.querySelector<HTMLElement>('[data-testid="range-rings-legend"]');
    expect(legend?.hidden).toBe(false);
    expect(legend?.textContent).toContain('FIRING RANGE');
    expect(legend?.textContent).toContain('SIGHT');

    // Deselection + Alt off -> overlay hides completely
    renderer.setAltPressed(false);
    renderer.update(view);
    expect(hudOverlay.querySelector<HTMLElement>('[data-testid="range-rings-overlay"]')?.hidden).toBe(true);
    renderer.dispose();
  });
});
