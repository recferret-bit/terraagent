import * as THREE from 'three';
import { getParticleGeometry } from './geometries';
import type { ParticleLayerSpec } from './types';
import type { VfxPoint3D } from '../visuals/projectiles/types';

export interface BurstOrigin {
  at: THREE.Vector3; normal: THREE.Vector3; groundY: number; scale?: number;
  source?: () => VfxPoint3D; direction?: () => VfxPoint3D;
}
interface Particle {
  age: number; life: number; size: number; spin: number; ground: number; landed?: boolean;
  pos: THREE.Vector3; velocity: THREE.Vector3; origin: THREE.Vector3; normal: THREE.Vector3;
  source?: () => VfxPoint3D; direction?: () => VfxPoint3D;
}
const Z = new THREE.Vector3(0, 0, 1);
const VERTEX_ALPHA = 'attribute float aBurstAlpha; varying float vBurstAlpha;';
const FRAGMENT_ALPHA = 'varying float vBurstAlpha;';

/** Six simultaneous bursts per layer, then recycle the oldest slot. No per-shot mesh allocation. */
export class BurstLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly particles: Array<Particle | undefined>;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly localNormal = new THREE.Vector3();
  private readonly inverseOrientation = new THREE.Quaternion();

  constructor(readonly spec: ParticleLayerSpec, parent: THREE.Object3D, name: string) {
    const capacity = spec.count * 6;
    const geometry = getParticleGeometry(spec.geometry).clone();
    geometry.computeBoundingBox();
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aBurstAlpha', this.alpha);
    const materialOptions = { color: spec.color, roughness: spec.roughness ?? 0.8,
      metalness: spec.metalness ?? 0, emissive: spec.color, emissiveIntensity: spec.emissiveIntensity ?? 0,
      transparent: true, depthWrite: false };
    this.material = spec.behavior
      ? new THREE.MeshPhysicalMaterial({ ...materialOptions, clearcoat: 1, clearcoatRoughness: 0.12 })
      : new THREE.MeshStandardMaterial(materialOptions);
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = VERTEX_ALPHA + '\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvBurstAlpha = aBurstAlpha;');
      shader.fragmentShader = FRAGMENT_ALPHA + '\n' + shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= vBurstAlpha;');
    };
    this.material.customProgramCacheKey = () => 'combat-burst-alpha-v1';
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    this.mesh.name = `${name}/${spec.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles = Array.from({ length: capacity });
    parent.add(this.mesh);
    this.clear();
  }

  emit(input: BurstOrigin, random: () => number): void {
    const s = this.spec;
    const range = (r: [number, number]) => r[0] + random() * (r[1] - r[0]);
    const normal = input.normal.clone().normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(Z, normal);
    for (let n = 0; n < s.count; n++) {
      const i = this.cursor++ % this.particles.length;
      const angle = random() * Math.PI * 2;
      const cos = 1 - random() * (1 - Math.cos(Math.min(1.45, s.spreadCone)));
      const sin = Math.sqrt(1 - cos * cos);
      const velocity = new THREE.Vector3(Math.cos(angle) * sin, Math.sin(angle) * sin, cos)
        .applyQuaternion(rotation).multiplyScalar(range(s.speedRange));
      velocity.y += range(s.upwardBias);
      const size = range(s.sizeRange) * (input.scale ?? 1);
      const p: Particle = { age: 0, life: range(s.lifetimeRange), size, spin: random() * 6,
        ground: input.groundY, origin: input.at.clone(), normal: normal.clone(), velocity,
        pos: input.at.clone().addScaledVector(normal, size * (input.source && s.role === 'accent' ? 0.7 * (s.stretchByVelocity ?? 1) : 0.55) + 0.015),
        ...(s.role === 'accent' && input.source ? { source: input.source, direction: input.direction } : {}) };
      if (s.behavior === 'splash') p.pos.copy(input.at).addScaledVector(normal, 0.015);
      this.particles[i] = p;
      this.write(i, p);
    }
  }

  update(dt: number): void {
    const s = this.spec;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p) continue;
      p.age += dt;
      if (p.age >= p.life) { this.particles[i] = undefined; this.hide(i); continue; }
      if (s.behavior === 'splash') { this.write(i, p); continue; }
      p.velocity.multiplyScalar(Math.exp(-s.drag * dt));
      p.velocity.y -= s.gravity * dt;
      p.pos.addScaledVector(p.velocity, dt);
      if (p.pos.y < p.ground + p.size * 0.15) {
        p.pos.y = p.ground + p.size * 0.15;
        p.velocity.y = Math.abs(p.velocity.y) * s.bounce;
        p.velocity.x *= 0.72; p.velocity.z *= 0.72;
        if (s.behavior === 'liquid') { p.landed = true; p.velocity.set(0, 0, 0); }
      }
      if (p.landed) p.pos.y = p.ground + p.size * 0.08;
      // Keep the burst on the outward side of its contact plane instead of spraying into the victim.
      const distance = p.pos.clone().sub(p.origin).dot(p.normal);
      const radius = p.size * (s.geometry === 'dustCloud' ? (0.65 + 1.6 * p.age / p.life) * 0.6 : 0.6);
      if (distance < radius && s.behavior !== 'liquid') {
        p.pos.addScaledVector(p.normal, radius - distance);
      }
      if (p.source) {
        const at = p.source();
        const dir = p.direction?.();
        if (dir) p.normal.set(dir.x, dir.y, dir.z ?? 0).normalize();
        p.pos.set(at.x, at.y, at.z ?? 0).addScaledVector(p.normal, p.size * 0.7 * (s.stretchByVelocity ?? 1) + 0.015);
      }
      this.write(i, p);
    }
  }

  private write(i: number, p: Particle): void {
    const s = this.spec;
    const u = p.age / p.life;
    const smoke = s.geometry === 'dustCloud';
    const size = p.size * (smoke ? 0.65 + 1.6 * u : 1 - 0.6 * u * u);
    this.dummy.position.copy(p.pos);
    this.dummy.scale.setScalar(size);
    if (s.behavior === 'splash') {
      this.dummy.quaternion.setFromUnitVectors(Z, p.normal);
      const spread = p.size * (0.45 + 0.55 * (1 - Math.exp(-u * 12)));
      this.dummy.scale.set(spread, spread, p.size * (0.12 + 0.88 * Math.pow(1 - u, 2)));
    } else if (p.landed) {
      this.dummy.rotation.set(0, p.spin, 0);
      this.dummy.scale.set(size * 1.6, p.size * 0.15, size * 1.4);
    } else if ((s.stretchByVelocity ?? 1) > 1) {
      const dir = p.source ? p.normal : p.velocity.clone().normalize();
      this.dummy.quaternion.setFromUnitVectors(Z, dir);
      this.dummy.scale.z *= s.stretchByVelocity!;
    } else this.dummy.rotation.set(p.spin + p.age * s.spinSpeed, p.spin * 2 + p.age, p.spin);
    if (s.behavior === 'liquid') this.constrainLiquidToSurface(p);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.alpha.setX(i, Math.min(1, (1 - u) * (smoke ? 2 : 4)) * (smoke ? 0.72 : 1));
    this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Project the complete oriented bounds, including stretch/flattening, onto the contact normal. */
  private constrainLiquidToSurface(p: Particle): void {
    const bounds = this.mesh.geometry.boundingBox!;
    const n = this.localNormal.copy(p.normal)
      .applyQuaternion(this.inverseOrientation.copy(this.dummy.quaternion).invert())
      .multiply(this.dummy.scale);
    const nearest = n.x * (n.x >= 0 ? bounds.min.x : bounds.max.x)
      + n.y * (n.y >= 0 ? bounds.min.y : bounds.max.y)
      + n.z * (n.z >= 0 ? bounds.min.z : bounds.max.z);
    const distance = p.normal.dot(p.pos) - p.normal.dot(p.origin);
    const correction = 0.015 - nearest - distance;
    if (correction > 0) {
      p.pos.addScaledVector(p.normal, correction);
      this.dummy.position.copy(p.pos);
    }
  }

  private hide(i: number): void {
    this.dummy.scale.setScalar(0); this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  get count(): number { return this.particles.filter(Boolean).length; }
  clear(): void { this.particles.fill(undefined); for (let i = 0; i < this.particles.length; i++) this.hide(i); }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.material.dispose(); }
}
