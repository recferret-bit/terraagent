import * as THREE from 'three';
import { TILE_M } from '../../planets/hex/hexMath';
import {
  buildUnitRingRibbonGeometry,
  computeRingHalfWidthM,
  createRingHeightTexture,
  decodeU16Pair,
  RING_HEIGHT_MIN,
  RING_HEIGHT_SPAN,
  RING_SEGMENTS,
  writeRingHeightRow,
  type RingHeightSampler,
} from './ringHeightTexture';
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
 * Canonical visual styles for battle range and view rings (`UO-C-08`, `CLIENT.md` §8b):
 * - `weapon`: bold solid ring in faction orange (`0xff6a13`, opacity `0.95`)
 * - `minRange`: dashed red ring (`0xff3b3b`, `36` segments, opacity `0.85`)
 * - `viewRange`: dashed energy-cyan sight ring (`0x39d0ff`, `48` base segments, opacity `0.84`)
 * - `enemyWeapon`: solid red ring on enemy hover (`0xff3b3b`, opacity `0.92`)
 * - `ghostWeapon`: solid faction orange ring on turret placement ghost (`0xff6a13`, opacity `0.90`)
 */
export const RING_STYLE_BY_KIND: Readonly<Record<RangeRingKind, RangeRingStyleSpec>> = {
  weapon: {
    colorHex: 0xff6a13,
    opacity: 0.95,
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
    colorHex: 0x39d0ff,
    opacity: 0.84,
    dashSegments: 48,
    dutyCycle: 0.56,
    dashed: true,
    kindCode: 2,
  },
  enemyWeapon: {
    colorHex: 0xff3b3b,
    opacity: 0.92,
    dashSegments: 0,
    dutyCycle: 1.0,
    dashed: false,
    kindCode: 3,
  },
  ghostWeapon: {
    colorHex: 0xff6a13,
    opacity: 0.9,
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
 * Single-draw-call `THREE.InstancedMesh` renderer for terrain-draped, render-on-top weapon and sight rings.
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
  private readonly rowAttr: THREE.InstancedBufferAttribute;
  private readonly heightTex: THREE.DataTexture;
  private readonly heightData: Uint8Array;
  private heightSampler: RingHeightSampler | null = null;
  private samplerRevision = 0;

  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private activeRings: RangeRingDescriptor[] = [];
  private lastRingsKey = '';

  constructor(
    private readonly scene?: THREE.Scene | null,
    maxInstances: number = DEFAULT_MAX_RING_INSTANCES,
  ) {
    this.maxInstances = Math.max(1, maxInstances);
    this.geometry = buildUnitRingRibbonGeometry(RING_SEGMENTS);

    const rows = new Float32Array(this.maxInstances);
    for (let i = 0; i < this.maxInstances; i++) rows[i] = i;
    this.rowAttr = new THREE.InstancedBufferAttribute(rows, 1);
    this.geometry.setAttribute('aRingRow', this.rowAttr);

    this.colorData = new Float32Array(this.maxInstances * 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.colorData, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aRingColor', this.colorAttr);

    this.styleData = new Float32Array(this.maxInstances * 4);
    this.styleAttr = new THREE.InstancedBufferAttribute(this.styleData, 4);
    this.styleAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aRingStyle', this.styleAttr);

    const hTex = createRingHeightTexture(this.maxInstances);
    this.heightTex = hTex.texture;
    this.heightData = hTex.data;

    this.material = createRingShaderMaterial(this.heightTex, this.maxInstances);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxInstances);
    this.mesh.name = 'instanced-range-rings';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.setColorAt(0, new THREE.Color(0xffffff));
    this.mesh.count = 0;
    this.mesh.visible = false;

    if (this.scene) {
      this.scene.add(this.mesh);
    }
  }

  /** Supplies the terrain surface height sampler used to drape every ring across dunes and ridges. */
  setHeightSampler(sampler: RingHeightSampler | null, revision?: number): void {
    const changed = this.heightSampler !== sampler;
    this.heightSampler = sampler;
    if (revision !== undefined) {
      if (revision !== this.samplerRevision) {
        this.samplerRevision = revision;
        this.lastRingsKey = '';
      }
    } else if (changed) {
      this.samplerRevision++;
      this.lastRingsKey = '';
    }
  }

  /** Decodes the packed terrain height for instance `instanceIdx` at perimeter segment `segmentIdx` (for tests). */
  sampleEncodedHeight(instanceIdx: number, segmentIdx: number): number {
    const row = Math.max(0, Math.min(this.maxInstances - 1, instanceIdx));
    const col = ((segmentIdx % RING_SEGMENTS) + RING_SEGMENTS) % RING_SEGMENTS;
    const p = (row * RING_SEGMENTS + col) * 4;
    return decodeU16Pair(this.heightData[p] ?? 0, this.heightData[p + 1] ?? 0, RING_HEIGHT_MIN, RING_HEIGHT_SPAN);
  }

  private computeRingsKey(inputs: readonly RangeRingInput[], terrainRev: number): string {
    let validCount = 0;
    let body = '';
    for (let i = 0; i < inputs.length && validCount < this.maxInstances; i++) {
      const r = inputs[i]!;
      if (!Number.isFinite(r.radiusTiles) || r.radiusTiles <= 0) continue;
      validCount++;
      body += `${r.entityId ?? ''}:${r.kind}:${r.radiusTiles}:${r.worldX.toFixed(2)},${(r.groundY ?? 0).toFixed(2)},${r.worldZ.toFixed(2)}:${r.colorHex ?? ''}:${r.opacity ?? ''}:${r.dashSegments ?? ''};`;
    }
    return `${terrainRev}:${this.samplerRevision}:${this.heightSampler ? 1 : 0}|${validCount}|${body}`;
  }

  /** Updates the instanced ring buffer in a single draw call (`mesh.count === activeRings.length`). */
  setRings(inputs: readonly RangeRingInput[], terrainRevision = 0): void {
    if (inputs.length === 0 && this.activeRings.length === 0 && this.mesh.count === 0) return;
    const key = this.computeRingsKey(inputs, terrainRevision);
    if (key === this.lastRingsKey && this.activeRings.length === this.mesh.count) return;
    this.lastRingsKey = key;

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
      const dashSegments =
        input.dashSegments !== undefined
          ? input.dashSegments
          : style.dashed
            ? Math.max(16, Math.round((2 * Math.PI * radiusMeters) / 2.6))
            : style.dashSegments;
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

      writeRingHeightRow(
        this.heightData,
        idx,
        input.worldX,
        input.worldZ,
        radiusMeters,
        worldY,
        computeRingHalfWidthM(radiusMeters, style.kindCode),
        this.heightSampler,
        RING_Y_OFFSET,
      );

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
    this.heightTex.needsUpdate = true;
  }

  clear(): void {
    this.lastRingsKey = '';
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
    this.heightTex.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
