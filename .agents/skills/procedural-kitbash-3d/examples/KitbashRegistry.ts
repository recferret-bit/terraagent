// .agents/skills/procedural-kitbash-3d/examples/KitbashRegistry.ts
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export type MaterialZoneId =
  | 'hullPrimary'
  | 'hullSecondary'
  | 'frameGunmetal'
  | 'solarCell'
  | 'glassVisor'
  | 'energyCyan'
  | 'warningAmber'
  | 'dangerCrimson'
  | 'terraformEmerald';

export interface MaterialZoneSpec {
  color: number;
  roughness: number;
  metalness: number;
  emissiveIntensity: number;
}

export const DEFAULT_MATERIAL_ZONES: Record<MaterialZoneId, MaterialZoneSpec> = {
  hullPrimary:      { color: 0xd8dee9, roughness: 0.42, metalness: 0.15, emissiveIntensity: 0.0 },
  hullSecondary:    { color: 0xe59838, roughness: 0.48, metalness: 0.10, emissiveIntensity: 0.0 },
  frameGunmetal:    { color: 0x242933, roughness: 0.55, metalness: 0.80, emissiveIntensity: 0.0 },
  solarCell:        { color: 0x162b4d, roughness: 0.20, metalness: 0.60, emissiveIntensity: 0.0 },
  glassVisor:       { color: 0x0f172a, roughness: 0.10, metalness: 0.90, emissiveIntensity: 0.0 },
  energyCyan:       { color: 0x00f0ff, roughness: 0.20, metalness: 0.10, emissiveIntensity: 3.8 },
  warningAmber:     { color: 0xffaa00, roughness: 0.20, metalness: 0.10, emissiveIntensity: 3.4 },
  dangerCrimson:    { color: 0xff2a55, roughness: 0.20, metalness: 0.10, emissiveIntensity: 4.2 },
  terraformEmerald: { color: 0x10b981, roughness: 0.20, metalness: 0.10, emissiveIntensity: 3.5 },
};

/**
 * GPU Vertex-Shader Animation Tag
 * Stored in `aPartAnim` (vec4: [animType, pivotX, pivotY, pivotZ])
 * - 0: Static
 * - 1: Continuous Y-axis rotation around (pivotX, pivotY, pivotZ)
 * - 2: Vertical hover/bob oscillation
 * - 3: Forward recoil / thumper oscillation
 */
export interface PartOptions {
  position?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  emissiveIntensity?: number;
  animType?: 0 | 1 | 2 | 3;
  animPivot?: THREE.Vector3Tuple;
}

export class KitbashBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private zones: Record<string, MaterialZoneSpec>;

  constructor(customZones?: Partial<Record<MaterialZoneId, MaterialZoneSpec>>) {
    this.zones = { ...DEFAULT_MATERIAL_ZONES, ...(customZones as Record<string, MaterialZoneSpec>) };
  }

  public addPart(
    geometry: THREE.BufferGeometry,
    zoneId: MaterialZoneId,
    options: PartOptions = {}
  ): this {
    const zone = this.zones[zoneId] || this.zones.hullPrimary;
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();

    // Apply transform matrix
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3(...(options.position ?? [0, 0, 0]));
    const euler = new THREE.Euler(...(options.rotation ?? [0, 0, 0]));
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const scl = new THREE.Vector3(...(options.scale ?? [1, 1, 1]));
    mat.compose(pos, quat, scl);
    g.applyMatrix4(mat);

    const count = g.attributes.position.count;
    const colorAttr = new Float32Array(count * 4);
    const surfaceAttr = new Float32Array(count * 2); // [roughness, metalness]
    const animAttr = new Float32Array(count * 4);    // [animType, pivotX, pivotY, pivotZ]

    const c = new THREE.Color(zone.color);
    const glow = options.emissiveIntensity ?? zone.emissiveIntensity;
    const mult = glow > 0 ? glow : 1.0;
    const pivot = options.animPivot ?? options.position ?? [0, 0, 0];
    const animType = options.animType ?? 0;

    for (let i = 0; i < count; i++) {
      colorAttr[i * 4 + 0] = c.r * mult;
      colorAttr[i * 4 + 1] = c.g * mult;
      colorAttr[i * 4 + 2] = c.b * mult;
      colorAttr[i * 4 + 3] = glow > 0 ? 1.0 : 0.0;

      surfaceAttr[i * 2 + 0] = zone.roughness;
      surfaceAttr[i * 2 + 1] = zone.metalness;

      animAttr[i * 4 + 0] = animType;
      animAttr[i * 4 + 1] = pivot[0];
      animAttr[i * 4 + 2] = pivot[1];
      animAttr[i * 4 + 3] = pivot[2];
    }

    g.setAttribute('color', new THREE.BufferAttribute(colorAttr, 4));
    g.setAttribute('aSurfacePBR', new THREE.BufferAttribute(surfaceAttr, 2));
    g.setAttribute('aPartAnim', new THREE.BufferAttribute(animAttr, 4));

    this.parts.push(g);
    return this;
  }

  public addGreeble<K extends string>(name: K, params: Record<string, any>): this {
    KitbashRegistry.invokeGreeble(name, params, this);
    return this;
  }

  public build(): THREE.BufferGeometry {
    if (this.parts.length === 0) {
      throw new Error('KitbashBuilder: Cannot build empty geometry.');
    }
    const merged = BufferGeometryUtils.mergeGeometries(this.parts, false);
    merged.computeVertexNormals();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

export type GreebleGeneratorFn<P = any> = (params: P, builder: KitbashBuilder) => void;
export type ArchetypeGeneratorFn<P = any> = (params: P) => THREE.BufferGeometry;

/**
 * Open Registry for Greebles (sub-parts) and Archetypes (complete units/buildings).
 * Agents can register new primitives or override existing ones at runtime.
 */
export class KitbashRegistry {
  private static greebles = new Map<string, GreebleGeneratorFn>();
  private static archetypes = new Map<string, ArchetypeGeneratorFn>();

  public static registerGreeble<P = any>(name: string, fn: GreebleGeneratorFn<P>): void {
    this.greebles.set(name, fn);
  }

  public static invokeGreeble(name: string, params: any, builder: KitbashBuilder): void {
    const fn = this.greebles.get(name);
    if (!fn) {
      throw new Error(`KitbashRegistry: Unknown greeble "${name}". Available: ${[...this.greebles.keys()].join(', ')}`);
    }
    fn(params, builder);
  }

  public static registerArchetype<P = any>(name: string, fn: ArchetypeGeneratorFn<P>): void {
    this.archetypes.set(name, fn);
  }

  public static createArchetype(name: string, params: any = {}): THREE.BufferGeometry {
    const fn = this.archetypes.get(name);
    if (!fn) {
      throw new Error(`KitbashRegistry: Unknown archetype "${name}". Available: ${[...this.archetypes.keys()].join(', ')}`);
    }
    return fn(params);
  }
}

// --- Built-in Core Greeble Registrations ---

KitbashRegistry.registerGreeble(
  'foundationPlinth',
  ({ width = 2, depth = 2, height = 0.24, skirtDepth = 0.12 }, builder) => {
    const totalH = height + skirtDepth;
    const base = new RoundedBoxGeometry(width, totalH, depth, 3, 0.06);
    builder.addPart(base, 'frameGunmetal', {
      position: [0, height - totalH * 0.5, 0],
    });
  }
);

KitbashRegistry.registerGreeble(
  'chamferedHull',
  ({ width = 1, height = 1, depth = 1, radius = 0.08, position = [0, 0.5, 0], zone = 'hullPrimary' as MaterialZoneId }, builder) => {
    const box = new RoundedBoxGeometry(width, height, depth, 4, radius);
    builder.addPart(box, zone, { position });
  }
);

KitbashRegistry.registerGreeble(
  'saggingCable',
  ({ p1 = [0, 0.5, 0], p2 = [0.5, 0.5, 0.5], slack = 0.18, radius = 0.03 }, builder) => {
    const v1 = new THREE.Vector3(...p1);
    const v2 = new THREE.Vector3(...p2);
    const mid = v1.clone().add(v2).multiplyScalar(0.5);
    mid.y -= slack;
    const curve = new THREE.CatmullRomCurve3([v1, mid, v2]);
    const tube = new THREE.TubeGeometry(curve, 12, radius, 6, false);
    builder.addPart(tube, 'frameGunmetal');
  }
);
