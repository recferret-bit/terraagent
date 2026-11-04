// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { TILE_M, tileXZ } from '@terra/render/planets/hex';
import { InstancedRangeRings, RING_STYLE_BY_KIND } from '@terra/render/visuals/rings';
import { ENTITY_KIND } from '@terra/sim';
import { loadFeatures, type FeatureContext, type GameView } from '../../../core/registry';
import { LandfallController } from '../../landfall';
import type { PlacementGhostState } from '../../construction-menu/PlacementGhost';
import {
  createRangeRingsRenderer,
  rangeRingsFeature,
  resolveEntityRingSpec,
  RING_ENTITY_KIND,
} from '../index';

function makeContext(overrides?: Partial<FeatureContext['services']>): {
  ctx: FeatureContext;
  scene: THREE.Scene;
} {
  const scene = new THREE.Scene();
  const flags = new Set(parseWaves('..07').list);
  const ctx: FeatureContext = {
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
  return { ctx, scene };
}

describe('W07-21 selection range and view rings', () => {
  it('selects the Autocannon -> renders an 8-tile weapon ring (16 m, solid orange) and a 9-tile view ring (18 m, dashed white 0.4)', () => {
    const landfall = new LandfallController({ ownerColonyIndex: 0, autoSelect: false });
    const { ctx, scene } = makeContext({ landfall });
    const renderer = createRangeRingsRenderer(ctx);

    const view: GameView = {
      entities: [
        { id: 101, kind: ENTITY_KIND.autocannon, owner: 0, q: 4, r: -2, x: 4, y: -2, hp: 450, hpMax: 450 },
      ],
    };

    renderer.update(view, 0.016);
    expect(landfall.selectEntity(101)).toBe(101);
    renderer.update(view, 0.016);

    const active = renderer.getActiveRings();
    expect(active).toHaveLength(2);
    expect(renderer.rings.mesh.count).toBe(2);
    expect(scene.children).toContain(renderer.rings.mesh);

    const weaponRing = active.find((r) => r.kind === 'weapon');
    const viewRing = active.find((r) => r.kind === 'viewRange');

    expect(weaponRing).toMatchObject({
      entityId: 101,
      kind: 'weapon',
      radiusTiles: 8,
      radiusMeters: 8 * TILE_M,
      colorHex: RING_STYLE_BY_KIND.weapon.colorHex,
      opacity: 0.9,
      dashed: false,
    });
    expect(viewRing).toMatchObject({
      entityId: 101,
      kind: 'viewRange',
      radiusTiles: 9,
      radiusMeters: 9 * TILE_M,
      colorHex: 0xffffff,
      opacity: 0.4,
      dashed: true,
    });

    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    renderer.rings.mesh.getMatrixAt(0, mat);
    mat.decompose(pos, quat, scale);
    expect(scale.x).toBeCloseTo(16, 4);
    expect(scale.z).toBeCloseTo(16, 4);

    renderer.dispose();
  });

  it('selects demoArtillery -> renders weapon ring (14 tiles = 28 m), min-range ring (3 tiles = 6 m, dashed red), and view ring (6 tiles = 12 m)', () => {
    const { ctx } = makeContext();
    const renderer = createRangeRingsRenderer(ctx);

    const view: GameView = {
      entities: [
        { id: 202, kind: RING_ENTITY_KIND.demoArtillery, owner: 0, q: 2, r: 3, x: 2, y: 3, hp: 200, hpMax: 200 },
      ],
    };

    renderer.setSelectedEntityIds([202]);
    renderer.update(view, 0.016);

    const active = renderer.getActiveRings();
    expect(active).toHaveLength(3);
    expect(renderer.rings.mesh.count).toBe(3);

    expect(active.find((r) => r.kind === 'weapon')).toMatchObject({
      entityId: 202,
      radiusTiles: 14,
      radiusMeters: 28,
      colorHex: 0xff6a13,
      dashed: false,
    });
    expect(active.find((r) => r.kind === 'minRange')).toMatchObject({
      entityId: 202,
      radiusTiles: 3,
      radiusMeters: 6,
      colorHex: 0xff3b3b,
      dashed: true,
    });
    expect(active.find((r) => r.kind === 'viewRange')).toMatchObject({
      entityId: 202,
      radiusTiles: 6,
      radiusMeters: 12,
      colorHex: 0xffffff,
      opacity: 0.4,
      dashed: true,
    });

    renderer.dispose();
  });
});

describe('W07-21 Alt all-units view and enemy hover rings', () => {
  it('holds Alt with multiple own units -> renders all own units and turrets rings in 1 InstancedMesh draw call', () => {
    const { ctx } = makeContext();
    const renderer = createRangeRingsRenderer(ctx);

    const view: GameView = {
      entities: [
        { id: 1, kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 900, hpMax: 900 },
        { id: 2, kind: ENTITY_KIND.recon, owner: 0, q: 3, r: 0, x: 3, y: 0, hp: 160, hpMax: 160 },
        { id: 3, kind: ENTITY_KIND.autocannon, owner: 0, q: 5, r: 0, x: 5, y: 0, hp: 450, hpMax: 450 },
        { id: 4, kind: RING_ENTITY_KIND.demoArtillery, owner: 0, q: 6, r: 0, x: 6, y: 0, hp: 200, hpMax: 200 },
        { id: 5, kind: ENTITY_KIND.harvester, owner: 0, q: 2, r: 2, x: 2, y: 2, hp: 160, hpMax: 160 },
        { id: 99, kind: ENTITY_KIND.greenSpitter, owner: -1, q: 15, r: 0, x: 15, y: 0, hp: 180, hpMax: 180 },
      ],
    };

    renderer.update(view, 0.016);
    expect(renderer.rings.mesh.count).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    renderer.update(view, 0.016);

    const active = renderer.getActiveRings();
    expect(active).toHaveLength(10);
    expect(renderer.rings.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(renderer.rings.mesh.count).toBe(10);
    expect(active.some((r) => r.entityId === 99)).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false }));
    renderer.update(view, 0.016);
    expect(renderer.rings.mesh.count).toBe(0);

    renderer.dispose();
  });

  it('hovers an enemy (greenSpitter or enemy turret) -> renders red enemyWeapon ring at its weapon range', () => {
    let hoveredPick: { q: number; r: number } | null = { q: 10, r: -4 };
    const { ctx } = makeContext({
      pickTile: () => hoveredPick,
    });
    const renderer = createRangeRingsRenderer(ctx);

    const view: GameView = {
      entities: [
        { id: 77, kind: ENTITY_KIND.greenSpitter, owner: -1, q: 10, r: -4, x: 10, y: -4, hp: 180, hpMax: 180 },
        { id: 88, kind: ENTITY_KIND.autocannon, owner: 1, q: -8, r: 5, x: -8, y: 5, hp: 450, hpMax: 450 },
      ],
    };

    window.dispatchEvent(new Event('pointermove'));
    renderer.update(view, 0.016);

    const spitterRings = renderer.getActiveRings();
    expect(spitterRings).toHaveLength(1);
    expect(spitterRings[0]).toMatchObject({
      entityId: 77,
      kind: 'enemyWeapon',
      radiusTiles: 6,
      radiusMeters: 12,
      colorHex: 0xff3b3b,
    });

    hoveredPick = { q: -8, r: 5 };
    window.dispatchEvent(new Event('pointermove'));
    renderer.update(view, 0.016);

    const turretRings = renderer.getActiveRings();
    expect(turretRings).toHaveLength(1);
    expect(turretRings[0]).toMatchObject({
      entityId: 88,
      kind: 'enemyWeapon',
      radiusTiles: 8,
      radiusMeters: 16,
      colorHex: 0xff3b3b,
    });

    renderer.dispose();
  });
});

describe('W07-21 turret placement ghost rings and wave gating', () => {
  it('arms a turret placement ghost (autocannon or laserTower) -> renders ghostWeapon range ring on the ghost footprint', () => {
    let ghostState: PlacementGhostState | null = {
      building: 'autocannon',
      label: 'Autocannon Turret',
      q: 6,
      r: -3,
      rotation: 0,
      footprintW: 1,
      footprintD: 1,
      footprintText: '1×1',
      tiles: [{ q: 6, r: -3, tileIdx: 12, deposit: 0, terrain: 0, prep: 1 }],
      prepBill: {},
      prepBillText: 'Site prepared',
      valid: true,
      statusColor: 'green',
      reason: 'valid site',
      depositCovered: false,
      depositTileIndices: [],
    };

    const { ctx } = makeContext({
      getPlacementGhostState: () => ghostState,
    });
    const renderer = createRangeRingsRenderer(ctx);

    renderer.update({}, 0.016);
    const autoGhostRings = renderer.getActiveRings();
    const autoWeapon = autoGhostRings.find((r) => r.kind === 'ghostWeapon');
    const autoView = autoGhostRings.find((r) => r.kind === 'viewRange');
    const [expectedX, expectedZ] = tileXZ(6, -3);

    expect(autoWeapon).toMatchObject({
      kind: 'ghostWeapon',
      radiusTiles: 8,
      radiusMeters: 16,
      colorHex: 0xff6a13,
    });
    expect(autoWeapon?.worldX).toBeCloseTo(expectedX, 4);
    expect(autoWeapon?.worldZ).toBeCloseTo(expectedZ, 4);
    expect(autoView).toMatchObject({
      kind: 'viewRange',
      radiusTiles: 9,
      radiusMeters: 18,
    });

    ghostState = { ...ghostState, building: 'laserTower', label: 'Laser Tower' };
    renderer.update({}, 0.016);
    const laserGhostRings = renderer.getActiveRings();
    expect(laserGhostRings.find((r) => r.kind === 'ghostWeapon')).toMatchObject({
      kind: 'ghostWeapon',
      radiusTiles: 9,
      radiusMeters: 18,
      colorHex: 0xff6a13,
    });
    expect(laserGhostRings.find((r) => r.kind === 'viewRange')).toMatchObject({
      kind: 'viewRange',
      radiusTiles: 10,
      radiusMeters: 20,
    });

    renderer.dispose();
  });

  it('resolves unit, building, and fauna specs and skips loading range-rings when W07 flag is off (..06)', () => {
    expect(rangeRingsFeature.id).toBe('range-rings');
    expect(rangeRingsFeature.wave).toBe('W07');

    const flagsW06 = new Set(parseWaves('..06').list);
    const flagsW07 = new Set(parseWaves('..07').list);
    expect(loadFeatures({ flags: flagsW06, host: 'server' }).some((f) => f.id === 'range-rings')).toBe(false);
    expect(loadFeatures({ flags: flagsW07, host: 'server' }).some((f) => f.id === 'range-rings')).toBe(true);

    expect(resolveEntityRingSpec('hq')).toMatchObject({ weaponRangeTiles: 5, minRangeTiles: 0, viewRangeTiles: 9 });
    expect(resolveEntityRingSpec('recon')).toMatchObject({ weaponRangeTiles: 4, minRangeTiles: 0, viewRangeTiles: 10 });
    expect(resolveEntityRingSpec('demoTank')).toMatchObject({ weaponRangeTiles: 7, minRangeTiles: 0, viewRangeTiles: 8 });
    expect(resolveEntityRingSpec('demoArtillery')).toMatchObject({ weaponRangeTiles: 14, minRangeTiles: 3, viewRangeTiles: 6 });
    expect(resolveEntityRingSpec('commandHub')).toMatchObject({ weaponRangeTiles: 0, viewRangeTiles: 7.5 });
    expect(resolveEntityRingSpec('outpostBeacon')).toMatchObject({ weaponRangeTiles: 0, viewRangeTiles: 6.5 });
    expect(resolveEntityRingSpec('blackAnt')).toMatchObject({ weaponRangeTiles: 1 });
    expect(resolveEntityRingSpec('blueBeetle')).toMatchObject({ weaponRangeTiles: 1 });
    expect(resolveEntityRingSpec('greenSpitter')).toMatchObject({ weaponRangeTiles: 6 });
  });

  it('InstancedRangeRings shader chunks compile into named vertex/fragment shaders without monolithic templates', () => {
    const rings = new InstancedRangeRings(null, 16);
    expect(rings.material.vertexShader).toContain('aRingStyle');
    expect(rings.material.fragmentShader).toContain('computeRingDashMask');
    expect(rings.material.fragmentShader).toContain('computeRingRadialMask');
    rings.dispose();
  });
});
