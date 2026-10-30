import * as THREE from 'three';
import { PLAYER_COLORS, smooth01 } from './terraform';

interface Item { pos: THREE.Vector3; quat: THREE.Quaternion; r: number; w: number; h: number; d: number; stack: boolean; owner: number; slot: number }

/**
 * Forge cities: 3D stacks, slabs and glowing caps around each colony. Built lazily (only globes that get terraformed pay),
 * they rise as their colony's front reaches them and sink away again with the globe's opacity during a morph.
 */
export class ColonyStructures {
  private items: Item[] = [];
  private stacksM: THREE.InstancedMesh | null = null;
  private slabsM: THREE.InstancedMesh | null = null;
  private capsM: THREE.InstancedMesh | null = null;
  private rf = 0;
  private opacity = 1;
  private readonly m = new THREE.Matrix4();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(private readonly parent: THREE.Object3D, private readonly colonies: THREE.Vector3[], private readonly radius: number, private readonly seed: number) {}

  setRf(rf: number) { this.rf = rf; }
  setOpacity(o: number) { this.opacity = o; }

  ensure() {
    if (this.stacksM) return;
    const { radius, seed } = this;
    const rng = (a: number, b: number) => { const x = Math.sin(seed * 91.7 + a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
    const Y = new THREE.Vector3(0, 1, 0), yaw = new THREE.Quaternion();
    const items = this.items;
    this.colonies.forEach((n, ci) => {
      const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      for (let k = 0; k < 21; k++) {
        const stack = k < 12;
        const r = 0.025 + 0.27 * Math.sqrt(rng(ci * 50 + k, 1)), az = rng(ci * 50 + k, 2) * Math.PI * 2;
        const dir = t1.clone().multiplyScalar(Math.cos(az)).addScaledVector(t2, Math.sin(az));
        const up = n.clone().multiplyScalar(Math.cos(r)).addScaledVector(dir, Math.sin(r)).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(Y, up);
        if (!stack) quat.multiply(yaw.setFromAxisAngle(Y, rng(ci * 50 + k, 3) * Math.PI));
        const near = 1 - r / 0.3;                                   // taller toward the colony core
        const pos = up.clone().multiplyScalar(radius * 0.998);
        items.push(stack
          ? { pos, quat, r, owner: ci, stack, slot: 0, w: radius * (0.011 + 0.01 * rng(k, ci)), h: radius * (0.03 + 0.05 * near * rng(k, ci + 3)), d: 0 }
          : { pos, quat, r, owner: ci, stack, slot: 0, w: radius * (0.022 + 0.03 * rng(k, ci + 5)), h: radius * (0.008 + 0.016 * rng(k, ci + 7)), d: radius * (0.02 + 0.03 * rng(k, ci + 9)) });
      }
    });
    const nStacks = items.filter((x) => x.stack).length, nSlabs = items.length - nStacks;
    const metal = new THREE.MeshStandardMaterial({ color: 0x3c3f49, metalness: 0.7, roughness: 0.45 });
    const stacksM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.9, 1, 7).translate(0, 0.5, 0), metal, nStacks);
    const slabsM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), metal, nSlabs);
    const capsM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.6), fog: false }), nStacks);
    let si = 0, bi = 0; const c = new THREE.Color();
    for (const it of items) {
      if (it.stack) { it.slot = si; capsM.setColorAt(si++, c.setRGB(...PLAYER_COLORS[it.owner])); } else it.slot = bi++;
    }
    for (const m of [stacksM, slabsM, capsM]) { m.frustumCulled = false; m.renderOrder = 1; this.parent.add(m); }
    this.stacksM = stacksM; this.slabsM = slabsM; this.capsM = capsM;
  }

  layout() {
    const { stacksM, slabsM, capsM, m, s, p } = this;
    if (!stacksM || !slabsM || !capsM) return;
    const of = smooth01((this.opacity - 0.55) / 0.45);                    // sink away while the globe fades out / rise as it fades in
    for (const it of this.items) {
      const grow = smooth01((this.rf - it.r - 0.03) / 0.12) * of;
      if (it.stack) {
        s.set(it.w, Math.max(it.h * grow, 1e-5), it.w);
        stacksM.setMatrixAt(it.slot, m.compose(it.pos, it.quat, s));
        p.set(0, 1, 0).applyQuaternion(it.quat).multiplyScalar(it.h * grow).add(it.pos);
        capsM.setMatrixAt(it.slot, m.compose(p, it.quat, s.setScalar(Math.max(it.w * 0.55 * grow, 1e-5))));
      } else {
        s.set(it.w, Math.max(it.h * grow, 1e-5), it.d);
        slabsM.setMatrixAt(it.slot, m.compose(it.pos, it.quat, s));
      }
    }
    for (const mesh of [stacksM, slabsM, capsM]) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.stacksM, this.slabsM, this.capsM]) if (m) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}
