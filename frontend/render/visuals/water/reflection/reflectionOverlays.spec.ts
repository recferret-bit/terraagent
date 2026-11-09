import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EntityProjectorRig } from '../../../lighting/EntityProjectorRig';
import { hideOverlayMaterials, isMirrorOverlay, showMaterials } from './reflectionOverlays';

const basic = (p: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial(p);

describe('mirror overlay rule', () => {
  it('leaves out transparent materials without depth write (lamp beams, pools, bars, rings, ghosts)', () => {
    const rig = new EntityProjectorRig('robot.hero');
    for (const m of [rig.beamMat, rig.poolMat, rig.lensMat, rig.haloMat]) expect(isMirrorOverlay(m)).toBe(true);
    rig.dispose();
    expect(isMirrorOverlay(basic({ transparent: true, depthWrite: false, depthTest: false }))).toBe(true); // health bar
    expect(isMirrorOverlay(basic({ transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }))).toBe(true); // ghost
    expect(isMirrorOverlay(new THREE.PointsMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))).toBe(true);
  });

  it('keeps world surfaces: opaque, alpha-tested, transparent with depth write (water, glass) and the sky dome', () => {
    expect(isMirrorOverlay(new THREE.MeshStandardMaterial())).toBe(false);
    expect(isMirrorOverlay(new THREE.MeshStandardMaterial({ alphaTest: 0.5 }))).toBe(false);
    expect(isMirrorOverlay(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.6 }))).toBe(false);
    expect(isMirrorOverlay(new THREE.ShaderMaterial({ depthWrite: false, depthTest: false, side: THREE.BackSide }))).toBe(false);
  });
});

describe('hideOverlayMaterials', () => {
  function scene() {
    const root = new THREE.Scene();
    const world = new THREE.MeshStandardMaterial();
    const shared = basic({ transparent: true, depthWrite: false });
    const a = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    const b = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    const child = new THREE.Mesh(new THREE.BufferGeometry(), world); // a world part parented under an overlay
    a.add(child);
    const mixedOverlay = basic({ transparent: true, depthWrite: false });
    const mixed = new THREE.Mesh(new THREE.BufferGeometry(), [world, mixedOverlay]);
    const hiddenGroup = new THREE.Group();
    hiddenGroup.visible = false;
    const underHidden = basic({ transparent: true, depthWrite: false });
    hiddenGroup.add(new THREE.Mesh(new THREE.BufferGeometry(), underHidden));
    root.add(a, b, mixed, hiddenGroup);
    return { root, world, shared, mixedOverlay, underHidden, child };
  }

  it('hides each overlay material once, per material: world parts and children stay, hidden subtrees are skipped', () => {
    const s = scene();
    const out: THREE.Material[] = [];
    hideOverlayMaterials(s.root, out);
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set([s.shared, s.mixedOverlay]));
    expect(s.shared.visible).toBe(false);
    expect(s.mixedOverlay.visible).toBe(false);
    expect(s.world.visible).toBe(true);
    expect(s.child.visible).toBe(true); // objects are never toggled
    expect(s.underHidden.visible).toBe(true); // not walked: three would not draw it anyway
    showMaterials(out);
    expect(out).toHaveLength(0);
    expect(s.shared.visible && s.mixedOverlay.visible).toBe(true);
  });

  it('a material that was already hidden is not collected, so it stays hidden after the restore', () => {
    const s = scene();
    s.shared.visible = false;
    const out: THREE.Material[] = [];
    hideOverlayMaterials(s.root, out);
    expect(out).toEqual([s.mixedOverlay]);
    showMaterials(out);
    expect(s.shared.visible).toBe(false);
  });
});
