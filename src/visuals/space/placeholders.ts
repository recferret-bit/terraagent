import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ArchetypeCatalog, createArchetypeMesh, tickArchetypeMesh } from '../../kitbash';

/** A model wrapped so that its pivot is bottom-centre (y=0) and its largest dimension is `size` (optional). */
export interface FittedModel {
  root: THREE.Group;
  mesh: THREE.Object3D;
  /** Size after fitting. */
  size: THREE.Vector3;
  placeholder: boolean;
  dispose(): void;
}

/** Clearly-labelled stand-in used until the real archetype is registered. */
function placeholderFor(id: string): THREE.Object3D {
  const g = new THREE.Group();
  g.name = `PLACEHOLDER ${id}`;
  const hull = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.4, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.6, roughness: 0.5 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x113344, emissive: 0x30d8ff, emissiveIntensity: 3.5 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  if (id === 'ship.carrier') {
    add(new THREE.CapsuleGeometry(1.6, 7, 6, 16).rotateZ(Math.PI / 2), hull, 0, 1.6, 0);
    add(new RoundedBoxGeometry(5, 0.35, 9, 3, 0.15), dark, 0, 1.3, 0);
    add(new RoundedBoxGeometry(2.6, 1.4, 3.4, 3, 0.3), hull, -1.5, 3.2, 0);
    for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(0.7, 0.9, 2.2, 16), dark, 5.2, 1.6, s * 2.6); add(new THREE.SphereGeometry(0.55, 12, 10), glow, 6.5, 1.6, s * 2.6); }
    add(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), dark, -3, 5, 0.6).rotation.z = 0.5;
    add(new RoundedBoxGeometry(0.2, 0.2, 0.2, 2, 0.05), glow, 0, 0.05, 0);
  } else if (id === 'ship.dropPod') {
    add(new THREE.CylinderGeometry(1.0, 1.35, 2.2, 20), hull, 0, 1.3, 0);
    add(new THREE.ConeGeometry(1.0, 1.3, 20), hull, 0, 3.05, 0);
    add(new THREE.SphereGeometry(1.35, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.45, 1), dark, 0, 0.2, 0);
    add(new THREE.TorusGeometry(1.05, 0.06, 6, 24).rotateX(Math.PI / 2), glow, 0, 1.9, 0);
  } else {
    add(new THREE.CapsuleGeometry(0.32, 0.7, 4, 10), hull, 0, 0.95, 0);
    add(new THREE.SphereGeometry(0.28, 14, 10), dark, 0, 1.75, 0);
    add(new THREE.SphereGeometry(0.1, 8, 6), glow, 0, 1.76, 0.2);
    for (const s of [-1, 1]) add(new THREE.CapsuleGeometry(0.12, 0.6, 3, 8), dark, s * 0.2, 0.35, 0);
  }
  return g;
}

/**
 * Build an archetype (or a placeholder if it is not registered yet) wrapped in a bottom-centre-pivot group.
 * `fit`: if given, the model's largest horizontal/vertical extent is scaled to `fit` only when it is outside
 * [fit*minRatio, fit*maxRatio] (so correctly-sized archetypes are left alone).
 */
export function acquireModel(id: string, biomeKey: string, fit?: { size: number; mode: 'max' | 'height'; minRatio?: number; maxRatio?: number; force?: boolean }): FittedModel {
  const has = ArchetypeCatalog.has(id);
  const mesh: THREE.Object3D = has ? createArchetypeMesh(id, biomeKey) : placeholderFor(id);
  if (!has) console.warn(`[space] archetype "${id}" not registered — using PLACEHOLDER`);
  const root = new THREE.Group();
  root.name = `fit:${id}`;
  root.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  mesh.position.set(-ctr.x, -box.min.y, -ctr.z);
  if (fit) {
    const cur = fit.mode === 'height' ? size.y : Math.max(size.x, size.y, size.z);
    const lo = fit.size * (fit.minRatio ?? 0.5), hi = fit.size * (fit.maxRatio ?? 2);
    if (fit.force || cur < lo || cur > hi) { const k = fit.size / Math.max(cur, 1e-4); root.scale.setScalar(k); size.multiplyScalar(k); }
  }
  return {
    root, mesh, size, placeholder: !has,
    dispose() {
      root.removeFromParent();
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });
    },
  };
}

export { tickArchetypeMesh };
