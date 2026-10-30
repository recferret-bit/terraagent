// .agents/skills/procedural-kitbash-3d/examples/KitbashRegistry.ts
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export type MaterialZoneId =
  | 'hullPrimary'
  | 'hullSecondary'
  | 'frameGunmetal'
  | 'rubberDark'
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
  // tyres, rollers, seals: near-black but matte, so it reads as rubber next to gunmetal
  rubberDark:       { color: 0x14171c, roughness: 0.85, metalness: 0.05, emissiveIntensity: 0.0 },
  // mid-blue (not near-black) so the cell grid reads against its gunmetal frame; gaps between cells show the dark backing
  solarCell:        { color: 0x2f6fc4, roughness: 0.22, metalness: 0.55, emissiveIntensity: 0.0 },
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
 * - 1: SpinY — Continuous Y-axis rotation around (pivotX, pivotY, pivotZ)
 * - 2: HoverBob — Vertical hover/bob oscillation (±5 cm)
 * - 3: RecoilPulse — Forward recoil / thumper oscillation along local +Z (0..6 cm)
 * - 4: BipedLeg — Rigid upper-leg (hip + thigh) sagittal pitch around hip pivot, coupled to BipedBody (8)
 * - 14: BipedShin — Rigid lower-leg (knee + shin + ankle) knee flexion around moving knee joint
 * - 24: BipedFoot — Rigid foot (foot + toe cap) dorsiflexed level with ground at moving ankle joint
 * - 5: BipedArm — Rigid counter-phase sagittal shoulder swing riding on BipedBody
 * - 6: SpiderLeg — Rigid upper-leg (hip + femur) 3D coxa yaw + femur elevation around hip pivot, coupled to SpiderBody (9)
 * - 16: SpiderTibia — Rigid lower-leg (knee + tibia + foot) coxa yaw around moving knee joint
 * - 7: WheelSpin — Continuous X-axis rolling rotation around wheel axle pivot
 * - 8: BipedBody — Bipedal pelvis/torso/head step-reaction (2ω heel-strike bounce, sway, roll, nod, yaw twist)
 *      (18 = SpinY on BipedBody, 28 = HoverBob on BipedBody, 38 = RecoilPulse on BipedBody)
 * - 9: SpiderBody — Arachnid/quadruped carapace/turret step-reaction (2ω stomp compression, diagonal roll, pitch, surge, yaw)
 *      (19 = SpinY on SpiderBody, 29 = HoverBob on SpiderBody, 39 = RecoilPulse on SpiderBody)
 */
export type AnimChannelId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 14 | 16 | 18 | 19 | 24 | 28 | 29 | 38 | 39;

export interface PartOptions {
  /** Human-readable label used by the model validator's reports (defaults to "<geometry type>#<index>"). */
  name?: string;
  position?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  emissiveIntensity?: number;
  animType?: AnimChannelId;
  animPivot?: THREE.Vector3Tuple;
}

/** What the model validator needs to know about each sub-part after merging. */
export interface PartMeta {
  index: number;
  name: string;
  zone: string;
  /** three.js geometry class the part was made from (RoundedBoxGeometry, CylinderGeometry, TubeGeometry, ...). */
  kind: string;
  animType: number;
  pivot: [number, number, number];
  emissive: number;
  /** Zone surface the part was stamped with (sRGB hex, roughness, metalness): the appearance checks read these. */
  color: number; roughness: number; metalness: number;
  /** Vertices this part owns in the merged buffer (parts are concatenated in order, non-indexed). */
  vertexCount: number;
}
export interface BuiltModel { geometry: THREE.BufferGeometry; parts: PartMeta[] }

export class KitbashBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private meta: PartMeta[] = [];
  private static sink: BuiltModel[] | null = null;

  /**
   * Run `fn` and collect every model any KitbashBuilder.build() produced meanwhile, with per-part metadata.
   * The geometry is the builder's merged object, so it already includes whatever a caller did to it afterwards in place
   * (scale, minY snap). Used by `kitbash/validate` and never by the game.
   */
  public static capture<T>(fn: () => T): { result: T; built: BuiltModel[] } {
    const prev = KitbashBuilder.sink; const built: BuiltModel[] = [];
    KitbashBuilder.sink = built;
    try { return { result: fn(), built }; } finally { KitbashBuilder.sink = prev; }
  }
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
    this.meta.push({
      index: this.parts.length, name: options.name ?? `${geometry.type.replace('Geometry', '')}#${this.parts.length}`, zone: zoneId,
      kind: geometry.type, animType, pivot: [pivot[0], pivot[1], pivot[2]], emissive: glow, color: zone.color, roughness: zone.roughness, metalness: zone.metalness, vertexCount: count,
    });

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
    KitbashBuilder.sink?.push({ geometry: merged, parts: this.meta.slice() });
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
