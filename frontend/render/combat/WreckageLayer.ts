import * as THREE from 'three';
import { createUnifiedColonyMaterial, RUIN_VARIANT } from '../visuals/UnifiedColonyMaterial';
import { captureWeaponSideMatrices } from './WeaponRig';
import { bakeWreckGeometry } from './wreckGeometry';

const DEFAULT_MAX_WRECKS = 96;

interface WreckEntry {
  id: number | null;
  x: number;
  z: number;
  footprintRadius: number;
  mesh: THREE.Mesh;
}

export interface PreserveWreckOptions {
  kind?: 'bot' | 'building';
  archetypeId?: string;
  buildStage?: number;
  position?: { x: number; y: number; z: number };
  groundY?: number;
  groundHeightAt?: (wx: number, wz: number) => number;
  footprintRadius?: number;
  tintColor?: THREE.ColorRepresentation | null;
}

export interface PreserveGeometryWreckOptions extends PreserveWreckOptions {
  position: { x: number; y: number; z: number };
  rotationY?: number;
  scale?: { x: number; y: number; z: number } | number;
  weaponMatrices?: readonly THREE.Matrix4[] | null;
  spinTime?: number;
  seed?: number;
}

function readMeshTint(mesh: THREE.Object3D): THREE.Color | null {
  const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
  const col = mat?.color;
  if (!col) return null;
  if (Math.abs(col.r - 1) < 1e-3 && Math.abs(col.g - 1) < 1e-3 && Math.abs(col.b - 1) < 1e-3) return null;
  return col.clone();
}

/**
 * Preserves shattered, distorted, charred robot and building wrecks directly on terrain
 * without retaining pooled live simulation meshes.
 */
export class WreckageLayer {
  readonly group = new THREE.Group();
  private readonly entries: WreckEntry[] = [];
  private readonly byId = new Map<number, WreckEntry>();
  private materialBundle: ReturnType<typeof createUnifiedColonyMaterial> | null = null;
  private biome: string;

  constructor(
    parent?: THREE.Object3D,
    biome = 'desert',
    private readonly maxWrecks = DEFAULT_MAX_WRECKS,
  ) {
    this.biome = biome;
    this.group.name = 'entity-wrecks';
    parent?.add(this.group);
  }

  private getMaterialBundle(): ReturnType<typeof createUnifiedColonyMaterial> {
    if (!this.materialBundle) {
      this.materialBundle = createUnifiedColonyMaterial({
        biome: this.biome,
        plugins: [RUIN_VARIANT],
        ruin: 1.0,
        rimStrength: 0.16,
      });
      this.materialBundle.uniforms.uWalkWeight.value = 0;
      this.materialBundle.uniforms.uWorkWeight.value = 0;
    }
    return this.materialBundle;
  }

  setBiome(biome: string): void {
    if (biome === this.biome) return;
    this.biome = biome;
    if (this.materialBundle) {
      const next = createUnifiedColonyMaterial({
        biome,
        plugins: [RUIN_VARIANT],
        ruin: 1.0,
        rimStrength: 0.16,
      });
      next.uniforms.uWalkWeight.value = 0;
      next.uniforms.uWorkWeight.value = 0;
      for (const entry of this.entries) {
        entry.mesh.material = next.material;
        entry.mesh.customDepthMaterial = next.depthMaterial;
      }
      this.materialBundle.material.dispose();
      this.materialBundle.depthMaterial.dispose();
      this.materialBundle = next;
    }
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  preserve(id: number | null, sourceMesh: THREE.Object3D, opts: PreserveWreckOptions = {}): boolean {
    const srcGeo = (sourceMesh as THREE.Mesh).geometry;
    if (!srcGeo) return false;
    const u = (sourceMesh.userData as { uniforms?: { uTime?: { value: number } }; archetypeId?: string } | undefined);
    const spinTime = u?.uniforms?.uTime?.value ?? 0;
    const weaponMatrices = captureWeaponSideMatrices(sourceMesh);
    const tintColor = opts.tintColor !== undefined ? opts.tintColor : readMeshTint(sourceMesh);
    return this.preserveFromGeometry(id, srcGeo, {
      ...opts,
      archetypeId: opts.archetypeId ?? u?.archetypeId,
      position: opts.position ?? { x: sourceMesh.position.x, y: sourceMesh.position.y, z: sourceMesh.position.z },
      rotationY: sourceMesh.rotation.y,
      scale: { x: sourceMesh.scale.x, y: sourceMesh.scale.y, z: sourceMesh.scale.z },
      weaponMatrices,
      spinTime,
      tintColor,
    });
  }

  preserveFromGeometry(
    id: number | null,
    srcGeo: THREE.BufferGeometry,
    opts: PreserveGeometryWreckOptions,
  ): boolean {
    if (id !== null && this.byId.has(id)) return false;
    const posAttr = srcGeo?.getAttribute('position');
    if (!posAttr || posAttr.count < 3) return false;

    const rotY = opts.rotationY ?? 0;
    const scaleRaw = opts.scale ?? 1;
    const sx = typeof scaleRaw === 'number' ? scaleRaw : scaleRaw.x;
    const sy = typeof scaleRaw === 'number' ? scaleRaw : scaleRaw.y;
    const sz = typeof scaleRaw === 'number' ? scaleRaw : scaleRaw.z;
    const wx = opts.position.x;
    const wz = opts.position.z;
    const baseY = opts.groundY ?? (opts.groundHeightAt ? opts.groundHeightAt(wx, wz) : opts.position.y);

    const cosYaw = Math.cos(rotY);
    const sinYaw = Math.sin(rotY);
    const sySafe = Math.max(1e-3, sy);
    const groundOffsetAt = opts.groundHeightAt
      ? (lx: number, lz: number) => {
          const rx = wx + (lx * cosYaw + lz * sinYaw) * sx;
          const rz = wz + (-lx * sinYaw + lz * cosYaw) * sz;
          return (opts.groundHeightAt!(rx, rz) - baseY) / sySafe;
        }
      : undefined;

    const seed = opts.seed ?? ((id ?? 0) * 1.73 + wx * 0.41 + wz * 0.67 + 1.13);
    const baked = bakeWreckGeometry(srcGeo, {
      seed,
      kind: opts.kind,
      buildStage: opts.buildStage,
      weaponMatrices: opts.weaponMatrices,
      spinTime: opts.spinTime,
      tintColor: opts.tintColor,
      groundOffsetAt,
    });

    const bundle = this.getMaterialBundle();
    const wreck = new THREE.Mesh(baked, bundle.material);
    wreck.customDepthMaterial = bundle.depthMaterial;
    wreck.name = `wreck:${opts.archetypeId ?? opts.kind ?? 'entity'}`;
    wreck.userData = { wreckEntityId: id, archetypeId: opts.archetypeId };
    wreck.position.set(wx, baseY, wz);
    wreck.rotation.set(0, rotY, 0);
    wreck.scale.set(sx, sy, sz);
    wreck.castShadow = true;
    wreck.receiveShadow = true;

    this.group.add(wreck);
    const entry: WreckEntry = {
      id,
      x: wx,
      z: wz,
      footprintRadius: opts.footprintRadius ?? (opts.kind === 'building' ? 1.8 : 0.8),
      mesh: wreck,
    };
    this.entries.push(entry);
    if (id !== null) this.byId.set(id, entry);
    this.evictExcess();
    return true;
  }

  private evictExcess(): void {
    while (this.entries.length > this.maxWrecks) {
      const oldest = this.entries.shift()!;
      if (oldest.id !== null) this.byId.delete(oldest.id);
      this.group.remove(oldest.mesh);
      oldest.mesh.geometry.dispose();
    }
  }

  remove(id: number): boolean {
    const entry = this.byId.get(id);
    if (!entry) return false;
    this.byId.delete(id);
    const idx = this.entries.indexOf(entry);
    if (idx >= 0) this.entries.splice(idx, 1);
    this.group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    return true;
  }

  /** Active entity wreck IDs tracked in this layer. */
  activeIds(): number[] {
    return [...this.byId.keys()];
  }

  /** Clears overlapping wrecks when new construction claims damaged tiles, preserving wrecks still tracked in `skipIds`. */
  clearInRadius(wx: number, wz: number, radius: number, skipIds?: ReadonlySet<number>): number {
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.id !== null && skipIds?.has(e.id)) continue;
      const limit = radius + e.footprintRadius;
      const dx = e.x - wx, dz = e.z - wz;
      if (dx * dx + dz * dz <= limit * limit) {
        this.entries.splice(i, 1);
        if (e.id !== null) this.byId.delete(e.id);
        this.group.remove(e.mesh);
        e.mesh.geometry.dispose();
        removed++;
      }
    }
    return removed;
  }

  get count(): number {
    return this.entries.length;
  }

  clear(): void {
    while (this.entries.length > 0) {
      const e = this.entries.pop()!;
      this.group.remove(e.mesh);
      e.mesh.geometry.dispose();
    }
    this.byId.clear();
  }

  dispose(): void {
    this.clear();
    if (this.materialBundle) {
      this.materialBundle.material.dispose();
      this.materialBundle.depthMaterial.dispose();
      this.materialBundle = null;
    }
    this.group.removeFromParent();
  }
}
