import * as THREE from 'three';
import { TILE_M } from '../../planets/hex/hexMath';
import { createRingShaderMaterial, type RingShaderUniforms } from './ringShader';

export type RangeRingKind = 'weapon' | 'minRange' | 'viewRange' | 'enemyWeapon' | 'ghostWeapon';

export interface RangeRingStyleSpec {
  readonly colorHex: number;
  readonly opacity: number;
  readonly dashSegments: number;
  readonly dutyCycle: number;
  readonly dashed: boolean;
  readonly kindCode: number;
}

/**
 * Canonical visual styles for battle v1 range and view rings (`UO-C-08`, `CLIENT.md` §8b):
 * - `weapon`: solid ring in faction orange (`0xff6a13`, opacity `0.90`)
 * - `minRange`: dashed red ring (`0xff3b3b`, `36` segments, opacity `0.85`)
 * - `viewRange`: thin dashed white ring (`0xffffff`, `48` segments, opacity `0.40`)
 * - `enemyWeapon`: red ring on enemy hover (`0xff3b3b`, opacity `0.85`)
 * - `ghostWeapon`: solid faction orange ring on turret placement ghost (`0xff6a13`, opacity `0.85`)
 */
export const RING_STYLE_BY_KIND: Readonly<Record<RangeRingKind, RangeRingStyleSpec>> = {
  weapon: {
    colorHex: 0xff6a13,
    opacity: 0.9,
    dashSegments: 0,
    dutyCycle: 1.0,
    dashed: false,
    kindCode: 0,
  },
  minRange: {
    colorHex: 0xff3b3b,
    opacity: 0.85,
    dashSegments: 36,
    dutyCycle: 0.55,
    dashed: true,
    kindCode: 1,
  },
  viewRange: {
    colorHex: 0xffffff,
    opacity: 0.4,
    dashSegments: 48,
    dutyCycle: 0.55,
    dashed: true,
    kindCode: 2,
  },
  enemyWeapon: {
    colorHex: 0xff3b3b,
    opacity: 0.85,
    dashSegments: 0,
    dutyCycle: 1.0,
    dashed: false,
    kindCode: 3,
  },
  ghostWeapon: {
    colorHex: 0xff6a13,
    opacity: 0.85,
    dashSegments: 0,
    dutyCycle: 1.0,
    dashed: false,
    kindCode: 4,
  },
};

export const RING_Y_OFFSET = 0.08;
export const DEFAULT_MAX_RING_INSTANCES = 256;

export interface RangeRingInput {
  entityId?: number;
  kind: RangeRingKind;
  radiusTiles: number;
  worldX: number;
  groundY?: number;
  worldZ: number;
  colorHex?: number;
  opacity?: number;
  dashSegments?: number;
}

export interface RangeRingDescriptor {
  entityId?: number;
  kind: RangeRingKind;
  radiusTiles: number;
  radiusMeters: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  colorHex: number;
  opacity: number;
  dashed: boolean;
  dashSegments: number;
}

/**
 * Single-draw-call `THREE.InstancedMesh` renderer for weapon, min-range, view, enemy-hover, and turret-ghost rings.
 * Each ring is scaled in world metres (`radiusMeters = radiusTiles * TILE_M` where `TILE_M = 2`).
 */
export class InstancedRangeRings {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial & { uniforms: RingShaderUniforms };
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly maxInstances: number;

  private readonly colorData: Float32Array;
  private readonly colorAttr: THREE.InstancedBufferAttribute;
  private readonly styleData: Float32Array;
  private readonly styleAttr: THREE.InstancedBufferAttribute;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private activeRings: RangeRingDescriptor[] = [];

  constructor(
    private readonly scene?: THREE.Scene | null,
    maxInstances: number = DEFAULT_MAX_RING_INSTANCES,
  ) {
    this.maxInstances = Math.max(1, maxInstances);
    this.geometry = new THREE.RingGeometry(0.97, 1.0, 64).rotateX(-Math.PI / 2);

    this.colorData = new Float32Array(this.maxInstances * 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.colorData, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aRingColor', this.colorAttr);

    this.styleData = new Float32Array(this.maxInstances * 4);
    this.styleAttr = new THREE.InstancedBufferAttribute(this.styleData, 4);
    this.styleAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aRingStyle', this.styleAttr);

    this.material = createRingShaderMaterial();
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxInstances);
    this.mesh.name = 'instanced-range-rings';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.setColorAt(0, new THREE.Color(0xffffff));
    this.mesh.count = 0;
    this.mesh.visible = false;

    if (this.scene) {
      this.scene.add(this.mesh);
    }
  }

  /** Updates the instanced ring buffer in a single draw call (`mesh.count === activeRings.length`). */
  setRings(inputs: readonly RangeRingInput[]): void {
    const next: RangeRingDescriptor[] = [];
    const limit = Math.min(inputs.length, this.maxInstances);

    for (let i = 0; i < inputs.length && next.length < limit; i++) {
      const input = inputs[i]!;
      if (!Number.isFinite(input.radiusTiles) || input.radiusTiles <= 0) continue;

      const style = RING_STYLE_BY_KIND[input.kind];
      const radiusMeters = input.radiusTiles * TILE_M;
      const worldY = (input.groundY ?? 0) + RING_Y_OFFSET;
      const colorHex = input.colorHex ?? style.colorHex;
      const opacity = input.opacity ?? style.opacity;
      const dashSegments = input.dashSegments ?? style.dashSegments;
      const dashed = dashSegments > 0;

      const idx = next.length;
      this.tmpPos.set(input.worldX, worldY, input.worldZ);
      this.tmpScale.set(radiusMeters, 1, radiusMeters);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.mesh.setMatrixAt(idx, this.tmpMatrix);

      this.tmpColor.setHex(colorHex);
      this.mesh.setColorAt(idx, this.tmpColor);

      const cOff = idx * 3;
      this.colorData[cOff] = this.tmpColor.r;
      this.colorData[cOff + 1] = this.tmpColor.g;
      this.colorData[cOff + 2] = this.tmpColor.b;

      const sOff = idx * 4;
      this.styleData[sOff] = opacity;
      this.styleData[sOff + 1] = dashSegments;
      this.styleData[sOff + 2] = style.dutyCycle;
      this.styleData[sOff + 3] = style.kindCode;

      next.push({
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        kind: input.kind,
        radiusTiles: input.radiusTiles,
        radiusMeters,
        worldX: input.worldX,
        worldY,
        worldZ: input.worldZ,
        colorHex,
        opacity,
        dashed,
        dashSegments,
      });
    }

    this.activeRings = next;
    this.mesh.count = next.length;
    this.mesh.visible = next.length > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.styleAttr.needsUpdate = true;
  }

  clear(): void {
    if (this.activeRings.length === 0 && this.mesh.count === 0) return;
    this.activeRings = [];
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  getActiveRings(): ReadonlyArray<RangeRingDescriptor> {
    return this.activeRings;
  }

  tick(dt: number): void {
    if (dt > 0) {
      this.material.uniforms.uTime.value = (this.material.uniforms.uTime.value + dt) % 3600;
    }
  }

  dispose(): void {
    this.clear();
    if (this.scene) {
      this.scene.remove(this.mesh);
    } else {
      this.mesh.removeFromParent();
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}
