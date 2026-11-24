import * as THREE from 'three';

interface Segment { from: THREE.Vector3; to: THREE.Vector3; age: number }
const CAPACITY = 256;
const TRAIL_LIFE_S = 0.44;
const Z = new THREE.Vector3(0, 0, 1);
/** World-space superheated artillery wake: bright incandescent plasma core + wide amber thermal halo. */
export class ArtilleryTrail {
  private readonly core: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly segments: Array<Segment | undefined> = Array.from({ length: CAPACITY });
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();
  constructor(parent: THREE.Object3D) {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geometry.rotateX(Math.PI / 2);
    this.core = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffe6a6).multiplyScalar(2.6),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), CAPACITY);
    this.glow = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff621a).multiplyScalar(1.75),
      transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), CAPACITY);
    this.core.name = 'artillery-trace-core'; this.glow.name = 'artillery-trace-halo';
    for (const mesh of [this.core, this.glow]) { mesh.frustumCulled = false; parent.add(mesh); }
    this.clear();
  }
  add(from: THREE.Vector3, to: THREE.Vector3): void {
    if (from.distanceToSquared(to) < 1e-8) return;
    const index = this.cursor++ % CAPACITY;
    this.segments[index] = { from: from.clone(), to: to.clone(), age: 0 };
    this.write(index, this.segments[index]!);
  }
  update(dt: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      const s = this.segments[i];
      if (!s) continue;
      s.age += dt;
      if (s.age >= TRAIL_LIFE_S) { this.segments[i] = undefined; this.hide(i); }
      else this.write(i, s);
    }
  }
  private write(i: number, s: Segment): void {
    const delta = s.to.clone().sub(s.from);
    const length = delta.length();
    this.dummy.position.copy(s.from).lerp(s.to, 0.5);
    this.dummy.quaternion.setFromUnitVectors(Z, delta.divideScalar(length));
    const fade = 1 - s.age / TRAIL_LIFE_S;
    const coreFade = Math.pow(fade, 1.25);
    this.dummy.scale.set(0.032 * coreFade, 0.032 * coreFade, length + 0.025);
    this.dummy.updateMatrix(); this.core.setMatrixAt(i, this.dummy.matrix);
    this.dummy.scale.set(0.088 * fade, 0.088 * fade, length + 0.04);
    this.dummy.updateMatrix(); this.glow.setMatrixAt(i, this.dummy.matrix);
    this.core.instanceMatrix.needsUpdate = true; this.glow.instanceMatrix.needsUpdate = true;
  }
  private hide(i: number): void {
    this.dummy.scale.setScalar(0); this.dummy.updateMatrix();
    for (const mesh of [this.core, this.glow]) { mesh.setMatrixAt(i, this.dummy.matrix); mesh.instanceMatrix.needsUpdate = true; }
  }
  get count(): number { return this.segments.filter(Boolean).length; }
  clear(): void { this.segments.fill(undefined); for (let i = 0; i < CAPACITY; i++) this.hide(i); }
  dispose(): void {
    this.core.geometry.dispose();
    for (const mesh of [this.core, this.glow]) { (mesh.material as THREE.Material).dispose(); mesh.removeFromParent(); }
  }
}
