import * as THREE from 'three';
import { getViewFocusQuad, type ViewFocus } from './viewFocus';

/**
 * Debug overlay (F8 → PERF → SHOW FOCUS RING, `?focusRing=1`) on the focus ground plane: the orange outline is the
 * view-focus quad (the padded camera footprint: where focus-limited effects stop), the dim orange circle its bounding
 * circle (prop compaction, shadow fit), the cyan circle the bare visible footprint circle. Drawn on top of everything
 * (no depth test), so they stay readable over hills; they are the exact shapes `viewFocus.ts` computes, not a drape.
 * Nothing is created until the ring is first switched on.
 */
const FOCUS_COLOR = 0xff6a13;
const BOUND_COLOR = 0x8a4a22;
const VISIBLE_COLOR = 0x38bfd4;
/** Band width as a fraction of the radius (reads as a thin line at every zoom). */
const BAND = 0.012;

export interface ViewFocusRing {
  /** Per frame: shows the rings in `scene` at `focus` (or hides them when `show` is false / the focus is off). */
  update(scene: THREE.Object3D, focus: Readonly<ViewFocus>, groundY: number, show: boolean): void;
  dispose(): void;
}

function ringMesh(color: number, order: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(1 - BAND, 1, 160, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = order;
  m.frustumCulled = false;
  m.raycast = () => {}; // never picked by game raycasts
  return m;
}

function quadLine(): THREE.LineLoop {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  const mat = new THREE.LineBasicMaterial({ color: FOCUS_COLOR, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const l = new THREE.LineLoop(geo, mat);
  l.renderOrder = 10002;
  l.frustumCulled = false;
  l.raycast = () => {};
  return l;
}

export function createViewFocusRing(): ViewFocusRing {
  let group: THREE.Group | null = null;
  let focusRing: THREE.Mesh | null = null;
  let visibleRing: THREE.Mesh | null = null;
  let quad: THREE.LineLoop | null = null;
  const build = (): THREE.Group => {
    group = new THREE.Group();
    group.name = 'viewFocusRing';
    focusRing = ringMesh(BOUND_COLOR, 10001);
    visibleRing = ringMesh(VISIBLE_COLOR, 10000);
    quad = quadLine();
    group.add(focusRing, visibleRing, quad);
    return group;
  };
  return {
    update(scene, focus, groundY, show) {
      const visible = show && focus.enabled;
      if (!visible) {
        if (group) group.visible = false;
        return;
      }
      const g = group ?? build();
      if (g.parent !== scene) scene.add(g);
      g.visible = true;
      g.position.set(focus.x, groundY + 0.05, focus.z);
      focusRing!.scale.setScalar(Math.max(0.01, focus.radius));
      visibleRing!.scale.setScalar(Math.max(0.01, focus.visibleRadius));
      const pos = quad!.geometry.getAttribute('position') as THREE.BufferAttribute;
      getViewFocusQuad().forEach(([x, z], i) => pos.setXYZ(i, x - focus.x, 0, z - focus.z));
      pos.needsUpdate = true;
    },
    dispose() {
      if (!group) return;
      group.removeFromParent();
      for (const m of [focusRing!, visibleRing!, quad!]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      group = focusRing = visibleRing = quad = null;
    },
  };
}
