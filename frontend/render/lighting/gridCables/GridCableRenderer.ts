import * as THREE from 'three';
import { CABLE_TIME_WRAP_S, createCableArcMaterial, type CableArcUniforms } from './cableArcMaterial';
import {
  buildCableGeometry,
  CABLE_STATE_CODE,
  type CableSpan,
  type CableSpanRange,
  type GroundSampler,
} from './cableGeometry';

/** Dark gunmetal conductor (the kitbash `frameGunmetal` zone: 0x242933, metalness 0.8, roughness 0.55). */
function createConductorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name: 'grid-cable', color: 0x242933, metalness: 0.8, roughness: 0.55 });
}

/** Geometry key: rounded anchor positions, sag and radius of every span (a state change alone never rebuilds). */
function shapeKey(spans: readonly CableSpan[]): string {
  const r = (n: number) => Math.round(n * 50);
  let key = '';
  for (const s of spans) key += `${r(s.a[0])},${r(s.a[1])},${r(s.a[2])}>${r(s.b[0])},${r(s.b[1])},${r(s.b[2])}~${r(s.sag)}/${r(s.radius)};`;
  return key;
}

/**
 * Power-grid cables between pylons, the Command Hub and attached buildings, with the lightning arc overlay. Two meshes
 * share one merged geometry (2 draw calls for the whole grid): the conductor (lit, shadow casting) and the additive
 * arc (`cableArcMaterial.ts`). `setSpans` rebuilds the geometry only when the grid's shape changes and patches the
 * state attribute in place otherwise; `update` advances one uniform per frame.
 */
export class GridCableRenderer {
  readonly group = new THREE.Group();
  private readonly conductorMat = createConductorMaterial();
  private readonly arcMat = createCableArcMaterial();
  private readonly conductor: THREE.Mesh;
  private readonly arc: THREE.Mesh;
  private ranges: CableSpanRange[] = [];
  private key = '';
  private time = 0;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'grid-cables';
    const empty = new THREE.BufferGeometry();
    this.conductor = new THREE.Mesh(empty, this.conductorMat);
    this.conductor.name = 'grid-cable-conductors';
    this.conductor.castShadow = true;
    this.arc = new THREE.Mesh(empty, this.arcMat);
    this.arc.name = 'grid-cable-arcs';
    this.arc.renderOrder = 3;
    this.group.add(this.conductor, this.arc);
    this.group.visible = false;
    parent.add(this.group);
  }

  get uniforms(): CableArcUniforms {
    return this.arcMat.uniforms;
  }

  /** Number of spans currently drawn. */
  get spanCount(): number {
    return this.ranges.length;
  }

  setSpans(spans: readonly CableSpan[], ground?: GroundSampler): void {
    const key = shapeKey(spans);
    if (key !== this.key) {
      this.key = key;
      const old = this.conductor.geometry;
      const { geometry, ranges } = buildCableGeometry(spans, ground);
      this.conductor.geometry = geometry;
      this.arc.geometry = geometry;
      this.ranges = ranges;
      old.dispose();
    } else {
      this.patchStates(spans);
    }
    this.group.visible = spans.length > 0;
  }

  private patchStates(spans: readonly CableSpan[]): void {
    const attr = this.conductor.geometry.getAttribute('aCable') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    let changed = false;
    for (let i = 0; i < spans.length && i < this.ranges.length; i++) {
      const code = CABLE_STATE_CODE[spans[i].state];
      const { start, count } = this.ranges[i];
      if (arr[start * 4 + 3] === code) continue;
      for (let v = start; v < start + count; v++) arr[v * 4 + 3] = code;
      changed = true;
    }
    if (changed) attr.needsUpdate = true;
  }

  update(dt: number): void {
    this.time = (this.time + Math.max(0, dt)) % CABLE_TIME_WRAP_S;
    this.arcMat.uniforms.uTime.value = this.time;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.conductor.geometry.dispose();
    this.conductorMat.dispose();
    this.arcMat.dispose();
  }
}
